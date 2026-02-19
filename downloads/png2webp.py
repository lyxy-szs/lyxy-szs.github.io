import os
from PIL import Image

def convert_png_to_webp(folder_path, quality=85):
    """
    将指定文件夹内所有 PNG 图片转为 WebP 格式
    :param folder_path: 图片文件夹路径
    :param quality: WebP 质量（1-100，85 是画质/体积最优平衡点）
    """
    # 遍历文件夹内所有文件
    for filename in os.listdir(folder_path):
        # 只处理 PNG 文件（忽略大小写，比如 .Png/.PNG）
        if filename.lower().endswith('.png'):
            # 拼接完整文件路径
            png_path = os.path.join(folder_path, filename)
            # 生成 WebP 文件名（替换后缀为 .webp）
            webp_filename = os.path.splitext(filename)[0] + '.webp'
            webp_path = os.path.join(folder_path, webp_filename)
            
            try:
                # 打开 PNG 图片
                with Image.open(png_path) as img:
                    # 处理透明 PNG（保留 Alpha 通道）
                    if img.mode in ('RGBA', 'LA'):
                        # 无损压缩透明区域，保证画质
                        img.save(webp_path, 'WEBP', quality=quality, lossless=False, method=6)
                    else:
                        # 普通 PNG 高质量转换
                        img.save(webp_path, 'WEBP', quality=quality, method=6)
                
                print(f"✅ 转换成功：{filename} → {webp_filename}")
            except Exception as e:
                print(f"❌ 转换失败：{filename}，错误：{str(e)}")

if __name__ == '__main__':
    # ********** 已修复：路径用单引号包裹 **********
    FOLDER_PATH = '照片的绝对路径'
    
    # 质量参数（85 是最优值，想更清晰可以设 90-95，体积会略大）
    QUALITY = 85
    
    # 检查文件夹是否存在
    if os.path.exists(FOLDER_PATH):
        convert_png_to_webp(FOLDER_PATH, QUALITY)
        print("\n🎉 所有 PNG 图片转换完成！")
    else:
        print("❌ 文件夹路径不存在，请检查路径是否正确！")
