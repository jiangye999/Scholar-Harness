#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NiceAIGC 浏览器模式模块

通过 OpenClaw browser 工具自动化操作 NiceAIGC 网页 UI
适用于无 API Key 但有会员账号的场景

工作流程：
1. 打开 NiceAIGC 对话页面（复用已登录的 Chrome）
2. 截取页面快照，识别输入框和发送按钮
3. 输入用户消息
4. 点击发送
5. 等待 AI 响应
6. 截取响应内容
7. 返回结果
"""

import json
import time
import subprocess
import sys
from typing import Dict, Any, Optional, Tuple
from pathlib import Path


class NiceAIGCBrowser:
    """NiceAIGC 浏览器自动化客户端"""
    
    def __init__(self, config: Dict[str, Any]):
        """
        初始化浏览器客户端
        
        Args:
            config: 完整配置字典
        """
        self.config = config
        self.niceaigc_config = config['niceaigc']
        self.browser_config = config['browser']
        
        self.chat_url = self.niceaigc_config.get('chat_url', 'https://niceaigc.com/chat')
        self.profile = self.browser_config.get('profile', 'chrome')
        self.timeout_ms = self.browser_config.get('timeout_ms', 30000)
        self.wait_for_response_ms = self.browser_config.get('wait_for_response_ms', 5000)
        
        # 元素选择器（可能需要根据实际页面调整）
        self.selectors = {
            'input_box': None,  # 自动识别
            'send_button': None,  # 自动识别
            'response_area': None  # 自动识别
        }
        
        print(f"[Browser] 初始化完成 | 页面：{self.chat_url}")
        print(f"[Browser] 浏览器配置：{self.profile} | 超时：{self.timeout_ms}ms")
    
    def send_message(self, message: str) -> str:
        """
        通过浏览器发送消息并获取响应
        
        Args:
            message: 用户消息
        
        Returns:
            AI 响应文本
        """
        print(f"[Browser] 开始发送消息 | 长度：{len(message)} 字符")
        
        try:
            # 步骤 1: 打开对话页面
            print("[Browser] 步骤 1/6: 打开对话页面...")
            self._open_chat_page()
            
            # 步骤 2: 等待页面加载
            print("[Browser] 步骤 2/6: 等待页面加载...")
            time.sleep(2)
            
            # 步骤 3: 截取快照，识别元素
            print("[Browser] 步骤 3/6: 识别页面元素...")
            snapshot = self._get_snapshot()
            input_ref, send_ref = self._identify_elements(snapshot)
            
            # 步骤 4: 输入消息
            print("[Browser] 步骤 4/6: 输入消息...")
            self._type_message(input_ref, message)
            
            # 步骤 5: 点击发送
            print("[Browser] 步骤 5/6: 发送消息...")
            self._click_send(send_ref)
            
            # 步骤 6: 等待并提取响应
            print("[Browser] 步骤 6/6: 等待 AI 响应...")
            response = self._wait_and_extract_response()
            
            print(f"[Browser] ✅ 收到响应 | 长度：{len(response)} 字符")
            return response
        
        except Exception as e:
            print(f"[Browser] ❌ 错误：{e}")
            raise
    
    def _open_chat_page(self):
        """打开对话页面"""
        cmd = [
            'openclaw', 'browser',
            '--action', 'open',
            '--url', self.chat_url,
            '--profile', self.profile
        ]
        self._run_command(cmd)
    
    def _get_snapshot(self) -> Dict[str, Any]:
        """截取页面快照"""
        cmd = [
            'openclaw', 'browser',
            '--action', 'snapshot',
            '--refs', 'aria',
            '--profile', self.profile
        ]
        result = self._run_command(cmd, capture_output=True)
        return json.loads(result) if result else {}
    
    def _identify_elements(self, snapshot: Dict[str, Any]) -> Tuple[str, str]:
        """
        从快照中识别输入框和发送按钮
        
        Returns:
            (input_ref, send_ref) 元素引用 ID
        """
        # 这里需要根据实际页面结构调整识别逻辑
        # 示例：查找包含"message"、"input"、"textarea"的元素
        
        input_ref = None
        send_ref = None
        
        # 简化版：使用预设的常见选择器
        # 实际使用时需要根据 NiceAIGC 页面调整
        
        elements = snapshot.get('elements', [])
        
        for elem in elements:
            ref = elem.get('ref', '')
            role = elem.get('role', '').lower()
            name = elem.get('name', '').lower()
            
            # 识别输入框
            if not input_ref:
                if role in ['textbox', 'textarea'] or 'input' in name or 'message' in name:
                    input_ref = ref
                    print(f"[Browser] 找到输入框：{ref}")
            
            # 识别发送按钮
            if not send_ref:
                if role == 'button' and ('send' in name or '发送' in name or 'submit' in name):
                    send_ref = ref
                    print(f"[Browser] 找到发送按钮：{ref}")
        
        if not input_ref:
            input_ref = 'e12'  # 默认 fallback
            print(f"[Browser] ⚠️ 未找到输入框，使用默认：{input_ref}")
        
        if not send_ref:
            send_ref = 'e14'  # 默认 fallback
            print(f"[Browser] ⚠️ 未找到发送按钮，使用默认：{send_ref}")
        
        return input_ref, send_ref
    
    def _type_message(self, ref: str, message: str):
        """在输入框中输入消息"""
        # 处理长消息（分块输入）
        cmd = [
            'openclaw', 'browser',
            '--action', 'act',
            '--kind', 'type',
            '--ref', ref,
            '--text', message,
            '--profile', self.profile
        ]
        self._run_command(cmd)
    
    def _click_send(self, ref: str):
        """点击发送按钮"""
        cmd = [
            'openclaw', 'browser',
            '--action', 'act',
            '--kind', 'click',
            '--ref', ref,
            '--profile', self.profile
        ]
        self._run_command(cmd)
    
    def _wait_and_extract_response(self) -> str:
        """等待 AI 响应并提取内容"""
        # 等待 AI 生成响应
        print(f"[Browser] 等待 {self.wait_for_response_ms}ms...")
        time.sleep(self.wait_for_response_ms / 1000)
        
        # 多次尝试提取响应（AI 可能还在生成）
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                snapshot = self._get_snapshot()
                response = self._extract_response_from_snapshot(snapshot)
                
                if response and len(response) > 10:
                    return response
                
                print(f"[Browser] 尝试 {attempt + 1}/{max_attempts}: 响应太短，继续等待...")
                time.sleep(2)
            
            except Exception as e:
                print(f"[Browser] 尝试 {attempt + 1}/{max_attempts}: 提取失败 - {e}")
                time.sleep(2)
        
        # 最后一次尝试
        snapshot = self._get_snapshot()
        return self._extract_response_from_snapshot(snapshot) or "（未能提取到响应）"
    
    def _extract_response_from_snapshot(self, snapshot: Dict[str, Any]) -> str:
        """从快照中提取 AI 响应文本"""
        # 查找最新的 AI 回复
        # 通常 AI 回复会有特定的角色标识或样式
        
        elements = snapshot.get('elements', [])
        responses = []
        
        for elem in elements:
            role = elem.get('role', '').lower()
            name = elem.get('name', '').lower()
            text = elem.get('text', '')
            
            # 识别 AI 回复区域
            if 'assistant' in name or 'ai' in name or 'model' in name:
                if text and len(text) > 10:
                    responses.append(text)
        
        # 返回最新的响应
        if responses:
            return responses[-1]
        
        # 备用方案：查找最后一个文本块
        for elem in reversed(elements):
            text = elem.get('text', '')
            if text and len(text) > 50:
                return text
        
        return ""
    
    def _run_command(self, cmd: list, capture_output: bool = False) -> Optional[str]:
        """运行 OpenClaw 命令"""
        print(f"[Browser] 执行：{' '.join(cmd)}")
        
        try:
            if capture_output:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                return result.stdout
            else:
                subprocess.run(cmd, timeout=30)
                return None
        except subprocess.TimeoutExpired:
            print(f"[Browser] ❌ 命令超时")
            raise
        except Exception as e:
            print(f"[Browser] ❌ 命令执行失败：{e}")
            raise
    
    def test_connection(self) -> bool:
        """测试浏览器连接"""
        try:
            print("[Browser] 测试连接...")
            self._open_chat_page()
            time.sleep(3)
            snapshot = self._get_snapshot()
            print(f"[Browser] ✅ 连接测试成功 | 页面元素数：{len(snapshot.get('elements', []))}")
            return True
        except Exception as e:
            print(f"[Browser] ❌ 连接测试失败：{e}")
            return False


# 快速测试
if __name__ == '__main__':
    # 加载配置
    config_path = Path(__file__).parent / 'config.json'
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    browser = NiceAIGCBrowser(config)
    
    test_message = "测试消息"
    if len(sys.argv) > 1:
        test_message = ' '.join(sys.argv[1:])
    
    try:
        response = browser.send_message(test_message)
        print(f"\nAI 响应：{response}")
    except Exception as e:
        print(f"错误：{e}")
        sys.exit(1)
