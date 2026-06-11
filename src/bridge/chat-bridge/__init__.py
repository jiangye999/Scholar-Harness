"""
NiceAIGC 桥接插件

用法：
    from niceaigc_bridge import NiceAIGCBridge
    
    bridge = NiceAIGCBridge()
    response = bridge.send_message("请帮我润色这段论文...")
    print(response)
"""

from .bridge import NiceAIGCBridge

__version__ = '0.1.0'
__all__ = ['NiceAIGCBridge']
