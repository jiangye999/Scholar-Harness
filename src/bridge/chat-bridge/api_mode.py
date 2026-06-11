#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NiceAIGC API 模式模块

直接调用 NiceAIGC API，速度快、稳定性高
需要有效的 API Key
"""

import requests
import json
from typing import Dict, Any, Optional
from pathlib import Path


class NiceAIGCAPI:
    """NiceAIGC API 客户端"""
    
    def __init__(self, config: Dict[str, Any]):
        """
        初始化 API 客户端
        
        Args:
            config: 完整配置字典
        """
        self.config = config['niceaigc']
        self.api_key = self.config.get('api_key', '')
        self.api_url = self.config.get('api_url', '')
        
        if not self.api_key:
            print("[API] ⚠️ 警告：未配置 API Key，API 模式将不可用")
        
        if not self.api_url:
            print("[API] ⚠️ 警告：未配置 API URL")
        
        # 默认请求头
        self.headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        }
        
        print(f"[API] 初始化完成 | URL: {self.api_url}")
    
    def send_message(self, message: str, **kwargs) -> str:
        """
        发送消息并获取响应
        
        Args:
            message: 用户消息
            **kwargs: 额外参数（model, temperature, max_tokens 等）
        
        Returns:
            AI 响应文本
        """
        if not self.api_key:
            raise ValueError("API Key 未配置")
        
        # 构建请求体
        payload = {
            'messages': [
                {'role': 'user', 'content': message}
            ],
            'model': kwargs.get('model', 'gpt-4'),
            'temperature': kwargs.get('temperature', 0.7),
            'max_tokens': kwargs.get('max_tokens', 2000)
        }
        
        print(f"[API] 发送请求 → {self.api_url}")
        print(f"[API] 消息长度：{len(message)} 字符")
        
        try:
            response = requests.post(
                self.api_url,
                headers=self.headers,
                json=payload,
                timeout=30
            )
            
            # 检查响应状态
            response.raise_for_status()
            
            # 解析响应
            result = response.json()
            
            # 提取 AI 回复
            if 'choices' in result and len(result['choices']) > 0:
                ai_response = result['choices'][0]['message']['content']
                print(f"[API] ✅ 收到响应 | 长度：{len(ai_response)} 字符")
                return ai_response
            else:
                raise ValueError(f"API 返回格式异常：{result}")
        
        except requests.exceptions.RequestException as e:
            print(f"[API] ❌ 请求失败：{e}")
            raise
        except json.JSONDecodeError as e:
            print(f"[API] ❌ 响应解析失败：{e}")
            raise
    
    def send_conversation(self, messages: list, **kwargs) -> str:
        """
        发送多轮对话
        
        Args:
            messages: 消息列表，格式：[{'role': 'user', 'content': '...'}, ...]
            **kwargs: 额外参数
        
        Returns:
            AI 响应文本
        """
        if not self.api_key:
            raise ValueError("API Key 未配置")
        
        payload = {
            'messages': messages,
            'model': kwargs.get('model', 'gpt-4'),
            'temperature': kwargs.get('temperature', 0.7),
            'max_tokens': kwargs.get('max_tokens', 2000)
        }
        
        print(f"[API] 发送多轮对话 | 消息数：{len(messages)}")
        
        try:
            response = requests.post(
                self.api_url,
                headers=self.headers,
                json=payload,
                timeout=60
            )
            
            response.raise_for_status()
            result = response.json()
            
            if 'choices' in result and len(result['choices']) > 0:
                return result['choices'][0]['message']['content']
            else:
                raise ValueError(f"API 返回格式异常：{result}")
        
        except Exception as e:
            print(f"[API] ❌ 请求失败：{e}")
            raise
    
    def test_connection(self) -> bool:
        """测试 API 连接"""
        if not self.api_key:
            print("[API] ❌ 测试失败：API Key 未配置")
            return False
        
        try:
            # 发送简单测试消息
            test_message = "Hello"
            response = self.send_message(test_message)
            print(f"[API] ✅ 连接测试成功 | 响应：{response[:50]}...")
            return True
        except Exception as e:
            print(f"[API] ❌ 连接测试失败：{e}")
            return False


# 快速测试
if __name__ == '__main__':
    import sys
    
    # 加载配置
    config_path = Path(__file__).parent / 'config.json'
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    api = NiceAIGCAPI(config)
    
    if len(sys.argv) > 1:
        message = ' '.join(sys.argv[1:])
    else:
        message = "测试消息"
    
    try:
        response = api.send_message(message)
        print(f"\nAI 响应：{response}")
    except Exception as e:
        print(f"错误：{e}")
        sys.exit(1)
