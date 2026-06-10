#!/usr/bin/env python3
"""Local analyzer API for Queen replay imports.

The React app owns rendering and generated levels. This service owns the
image/JSON recognition path inherited from dogku: screenshot -> region grid ->
unique-solution validation -> human reasoning steps.
"""

from __future__ import annotations

import base64
import binascii
import json
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, UnidentifiedImageError

from meowdoku_tool import analyze_level_data, build_level, recognize


MAX_REQUEST_BYTES = 20 * 1024 * 1024


def analyze_image(payload: dict) -> tuple[dict, dict]:
    encoded = payload.get("data_base64")
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("没有收到图片数据。")
    if "," in encoded and encoded.startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("图片数据不是有效的 Base64。") from error
    try:
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("无法读取图片，请上传 PNG 或 JPEG 截图。") from error

    expected_size = payload.get("expected_size")
    if expected_size is not None:
        try:
            expected_size = int(expected_size)
        except (TypeError, ValueError) as error:
            raise ValueError("expected_size 必须是整数。") from error

    try:
        recognized = recognize(image, expected_size, 28.0)
    except ValueError as error:
        raise ValueError(
            "未能从图片中识别出规则方形棋盘。"
            "请确认棋盘完整、基本水平且格子间隙清晰。"
        ) from error
    filename = str(payload.get("filename") or "uploaded-image.png")
    level, _, human_result = build_level(Path(filename), recognized, None)
    validation = level["validation"]
    if validation["region_count"] != level["size"]:
        raise ValueError(
            f"识别到 {validation['region_count']} 个色区，"
            f"但 {level['size']}x{level['size']} 棋盘需要 {level['size']} 个色区。"
        )
    if not validation["all_regions_connected"]:
        raise ValueError("图片中的一个或多个色区不连续，请检查识别结果。")
    if validation["solution_count"] == 0:
        raise ValueError("图片已识别，但该关卡无解。")
    if not validation["unique_solution"]:
        raise ValueError("图片已识别，但该关卡存在多个解。")
    if not human_result["solved"]:
        raise ValueError("图片已识别，但当前人类推理器无法完整推出。")
    return level, human_result


class Handler(BaseHTTPRequestHandler):
    server_version = "QueenAnalyzer/1.0"

    def log_message(self, format_string: str, *args: object) -> None:
        sys.stdout.write(f"[{self.log_date_time_string()}] {format_string % args}\n")

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "service": "queen-analyzer"})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/analyze":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "请求内容为空。"})
            return
        if length > MAX_REQUEST_BYTES:
            self.send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "上传内容超过 20MB。"},
            )
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            input_type = payload.get("input_type")
            if input_type == "image":
                level, human_result = analyze_image(payload)
            elif input_type == "level_json":
                level, human_result = analyze_level_data(
                    payload.get("level"),
                    str(payload.get("filename") or "uploaded-level.json"),
                )
                if not human_result["solved"]:
                    raise ValueError("导入关卡可识别，但当前人类推理器无法完整推出。")
            else:
                raise ValueError("input_type 必须是 image 或 level_json。")
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "请求不是有效的 JSON。"})
            return
        except ValueError as error:
            self.send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(error)})
            return
        except Exception as error:
            self.log_error("分析失败: %r", error)
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "分析时发生内部错误，请查看终端日志。"},
            )
            return

        self.send_json(
            HTTPStatus.OK,
            {
                "level": level,
                "human_solve": human_result,
            },
        )


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="启动 Queen 截图/JSON 分析 API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("Queen 分析服务已启动")
    print(f"API: http://{args.host}:{args.port}/api/analyze")
    print("按 Ctrl+C 停止服务")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
