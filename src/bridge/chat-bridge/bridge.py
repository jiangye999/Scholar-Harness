#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NiceAIGC 桥接插件 - 主模块

功能：
- 路由选择：API 模式 / 浏览器模式 / 自动模式
- 消息转发：本地项目 → NiceAIGC
- 结果回传：NiceAIGC → 本地项目

使用示例：
    from niceaigc_bridge import NiceAIGCBridge

    bridge = NiceAIGCBridge()
    response = bridge.send_message("请帮我润色这段论文...")
    print(response)
"""

import json
import os
import sys
from pathlib import Path
from typing import Optional, Dict, Any

# 导入子模块
from api_mode import NiceAIGCAPI
from browser_mode import NiceAIGCBrowser


class NiceAIGCBridge:
    """NiceAIGC 桥接器 - 智能路由选择"""

    def __init__(self, config_path: Optional[str] = None):
        """
        初始化桥接器

        Args:
            config_path: 配置文件路径，默认使用同目录下的 config.json
        """
        # 确定配置文件路径（统一使用 Path 类型）
        if config_path is None:
            config_path = str(Path(__file__).parent / "config.json")

        self.config_path: Path = Path(config_path)
        self.config = self._load_config()

        # 初始化子模块
        self.api_client = NiceAIGCAPI(self.config)
        self.browser_client = NiceAIGCBrowser(self.config)

        print(f"[Bridge] 初始化完成 | 模式：{self.config['mode']}")

    def _load_config(self) -> Dict[str, Any]:
        """加载配置文件"""
        if not self.config_path.exists():
            raise FileNotFoundError(f"配置文件不存在：{self.config_path}")

        with open(self.config_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def send_message(self, message: str, mode: Optional[str] = None) -> str:
        """
        发送消息到 NiceAIGC 并获取响应

        Args:
            message: 用户消息
            mode: 临时指定模式（可选），覆盖配置文件设置

        Returns:
            AI 响应文本
        """
        # 确定使用模式
        use_mode = mode or self.config["mode"]

        print(f"[Bridge] 发送消息 | 模式：{use_mode}")
        print(f"[Bridge] 消息长度：{len(message)} 字符")

        try:
            if use_mode == "api":
                return self._send_via_api(message)
            elif use_mode == "browser":
                return self._send_via_browser(message)
            elif use_mode == "auto":
                return self._send_auto(message)
            else:
                raise ValueError(f"未知模式：{use_mode}")

        except Exception as e:
            print(f"[Bridge] 错误：{e}")
            raise

    def _send_via_api(self, message: str) -> str:
        """通过 API 发送"""
        print("[Bridge] 使用 API 模式...")
        return self.api_client.send_message(message)

    def _send_via_browser(self, message: str) -> str:
        """通过浏览器发送"""
        print("[Bridge] 使用浏览器模式...")
        return self.browser_client.send_message(message)

    def _send_auto(self, message: str) -> str:
        """自动模式：优先 API，失败时降级到浏览器"""
        print("[Bridge] 使用自动模式（优先 API）...")

        # 尝试 API 模式
        if self.config["niceaigc"].get("api_key"):
            try:
                print("[Bridge] 尝试 API 模式...")
                return self._send_via_api(message)
            except Exception as e:
                print(f"[Bridge] API 模式失败：{e}")
                print("[Bridge] 降级到浏览器模式...")

        # API 不可用时使用浏览器模式
        return self._send_via_browser(message)

    def send_and_save(self, message: str, output_path: Optional[str] = None) -> str:
        """
        发送消息并保存结果到文件

        Args:
            message: 用户消息
            output_path: 输出文件路径（可选），默认使用配置文件设置

        Returns:
            AI 响应文本
        """
        # 获取响应
        response = self.send_message(message)

        # 确定输出路径（确保类型为 str，不能为 None）
        if output_path is None:
            output_path = str(
                self.config.get("local", {}).get(
                    "output_file", "/tmp/niceaigc_response.txt"
                )
            )

        # 保存结果（此时 output_path 已确保为 str）
        output_path_obj: Path = Path(output_path)
        output_path_obj.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path_obj, "w", encoding="utf-8") as f:
            f.write(response)

        print(f"[Bridge] 结果已保存到：{output_path_obj}")
        return response

    def test_api(self) -> bool:
        """测试 API 连接"""
        return self.api_client.test_connection()

    def test_browser(self) -> bool:
        """测试浏览器连接"""
        return self.browser_client.test_connection()


# 命令行入口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="NiceAIGC 桥接插件")
    parser.add_argument("--message", "-m", type=str, help="要发送的消息")
    parser.add_argument("--input", "-i", type=str, help="输入文件路径")
    parser.add_argument("--output", "-o", type=str, help="输出文件路径")
    parser.add_argument(
        "--mode",
        type=str,
        choices=["api", "browser", "auto"],
        help="运行模式（覆盖配置）",
    )
    parser.add_argument("--config", "-c", type=str, help="配置文件路径")
    parser.add_argument("--serve", action="store_true", help="启动 HTTP 服务")
    parser.add_argument("--port", type=int, default=8765, help="HTTP 服务端口")
    parser.add_argument("--test", action="store_true", help="测试连接")

    args = parser.parse_args()

    # 初始化桥接器
    bridge = NiceAIGCBridge(config_path=args.config)

    # 测试连接
    if args.test:
        print("\n=== 连接测试 ===")
        api_ok = bridge.test_api()
        browser_ok = bridge.test_browser()
        print(f"API 模式：{'✅ 正常' if api_ok else '❌ 失败'}")
        print(f"浏览器模式：{'✅ 正常' if browser_ok else '❌ 失败'}")
        sys.exit(0)

    # 获取消息
    message = args.message
    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            message = f.read()

    if not message:
        parser.print_help()
        print("\n❌ 错误：请提供消息（--message）或输入文件（--input）")
        sys.exit(1)

    # 发送消息
    if args.output:
        response = bridge.send_and_save(message, output_path=args.output)
    else:
        response = bridge.send_message(message, mode=args.mode)

    # 输出结果
    print("\n=== AI 响应 ===")
    print(response)
