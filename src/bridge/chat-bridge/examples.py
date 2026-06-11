#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NiceAIGC 桥接插件 - 使用示例

展示如何将桥接插件集成到学术论文写作项目中
"""

import sys
import json
from pathlib import Path

# 添加桥接插件到路径
sys.path.insert(0, str(Path(__file__).parent))

from bridge import NiceAIGCBridge


# ==================== 示例 1: 基础使用 ====================

def example_basic():
    """基础使用示例"""
    print("=" * 50)
    print("示例 1: 基础使用")
    print("=" * 50)
    
    bridge = NiceAIGCBridge()
    
    message = "请帮我润色以下论文摘要：\n\n本研究探讨了气候变化对生态系统的影响..."
    
    response = bridge.send_message(message)
    
    print(f"\nAI 响应:\n{response}")
    return response


# ==================== 示例 2: 指定模式 ====================

def example_with_mode():
    """指定运行模式"""
    print("\n" + "=" * 50)
    print("示例 2: 指定模式")
    print("=" * 50)
    
    bridge = NiceAIGCBridge()
    
    # 强制使用浏览器模式
    message = "帮我改写这句话，使其更学术化：The results show that..."
    
    response = bridge.send_message(message, mode='browser')
    
    print(f"\nAI 响应:\n{response}")
    return response


# ==================== 示例 3: 保存结果到文件 ====================

def example_save_to_file():
    """保存结果到文件"""
    print("\n" + "=" * 50)
    print("示例 3: 保存结果到文件")
    print("=" * 50)
    
    bridge = NiceAIGCBridge()
    
    message = "请列出 5 个论文写作中常见的逻辑错误"
    
    response = bridge.send_and_save(
        message,
        output_path='/tmp/niceaigc_output.txt'
    )
    
    print(f"\n结果已保存到 /tmp/niceaigc_output.txt")
    print(f"响应预览:\n{response[:200]}...")
    return response


# ==================== 示例 4: 集成到 FastAPI 后端 ====================

def example_fastapi_integration():
    """FastAPI 集成示例（伪代码）"""
    print("\n" + "=" * 50)
    print("示例 4: FastAPI 集成")
    print("=" * 50)
    
    fastapi_code = '''
from fastapi import FastAPI
from pydantic import BaseModel
from niceaigc_bridge import NiceAIGCBridge

app = FastAPI()
bridge = NiceAIGCBridge()

class ChatRequest(BaseModel):
    message: str
    mode: str = "auto"

@app.post("/api/chat")
async def chat(request: ChatRequest):
    """处理聊天请求"""
    response = bridge.send_message(request.message, mode=request.mode)
    return {"response": response}

@app.post("/api/chat/file")
async def chat_with_file(request: ChatRequest):
    """处理带文件输出的聊天请求"""
    response = bridge.send_and_save(request.message)
    return {"response": response, "saved_to": "/tmp/niceaigc_response.txt"}

# 运行：uvicorn main:app --reload --port 8000
'''
    
    print(fastapi_code)
    return fastapi_code


# ==================== 示例 5: 多轮对话 ====================

def example_conversation():
    """多轮对话示例"""
    print("\n" + "=" * 50)
    print("示例 5: 多轮对话")
    print("=" * 50)
    
    bridge = NiceAIGCBridge()
    
    # 从 API 模式模块导入（支持多轮对话）
    from api_mode import NiceAIGCAPI
    
    # 加载配置
    config_path = Path(__file__).parent / 'config.json'
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    api = NiceAIGCAPI(config)
    
    # 构建对话历史
    messages = [
        {'role': 'system', 'content': '你是一位学术论文编辑专家'},
        {'role': 'user', 'content': '帮我检查这句话的语法：The data was analyzed by using SPSS.'},
    ]
    
    try:
        response = api.send_conversation(messages)
        print(f"\nAI 响应:\n{response}")
        
        # 继续对话
        messages.append({'role': 'assistant', 'content': response})
        messages.append({'role': 'user', 'content': '还有其他需要注意的地方吗？'})
        
        response2 = api.send_conversation(messages)
        print(f"\n继续对话:\n{response2}")
        
    except Exception as e:
        print(f"多轮对话需要 API 模式支持：{e}")
        print("浏览器模式暂不支持多轮对话上下文")


# ==================== 示例 6: 批量处理 ====================

def example_batch_processing():
    """批量处理示例"""
    print("\n" + "=" * 50)
    print("示例 6: 批量处理")
    print("=" * 50)
    
    bridge = NiceAIGCBridge()
    
    messages = [
        "润色：This study is about climate change.",
        "润色：We found some interesting results.",
        "润色：The method we used is good.",
    ]
    
    print("批量处理 3 条消息...\n")
    
    for i, msg in enumerate(messages, 1):
        print(f"[{i}/3] {msg}")
        try:
            response = bridge.send_message(msg)
            print(f"    → {response[:100]}...\n")
        except Exception as e:
            print(f"    → 错误：{e}\n")


# ==================== 主程序 ====================

if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("   NiceAIGC 桥接插件 - 使用示例")
    print("=" * 60)
    
    examples = [
        ("基础使用", example_basic),
        ("指定模式", example_with_mode),
        ("保存文件", example_save_to_file),
        ("FastAPI 集成", example_fastapi_integration),
        ("多轮对话", example_conversation),
        ("批量处理", example_batch_processing),
    ]
    
    if len(sys.argv) > 1:
        # 运行指定示例
        try:
            idx = int(sys.argv[1]) - 1
            if 0 <= idx < len(examples):
                examples[idx][1]()
            else:
                print(f"无效示例编号：{idx + 1}")
        except ValueError:
            print("请使用数字选择示例（1-6）")
    else:
        # 显示菜单
        print("\n可用示例：")
        for i, (name, _) in enumerate(examples, 1):
            print(f"  {i}. {name}")
        print("\n运行方式：python3 examples.py [示例编号]")
        print("例如：python3 examples.py 1")
