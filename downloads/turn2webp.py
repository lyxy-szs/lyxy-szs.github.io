import os
from PIL import Image

def convert_image_to_webp(folder_path, quality=85):
    """
    将指定文件夹内所有常见格式图片转为 WebP 格式
    支持格式：PNG、JPG/JPEG、BMP、GIF（静态）、TIFF、ICO
    :param folder_path: 图片文件夹路径
    :param quality: WebP 质量（1-100，85 是画质/体积最优平衡点）
    """
    # 定义支持转换的图片格式（忽略大小写）
    SUPPORT_FORMATS = ('.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tiff', '.ico')
    
    # 遍历文件夹内所有文件
    for filename in os.listdir(folder_path):
        # 跳过文件夹，只处理文件
        file_full_path = os.path.join(folder_path, filename)
        if os.path.isdir(file_full_path):
            continue
        
        # 检查文件后缀是否在支持列表中（忽略大小写）
        file_ext = os.path.splitext(filename)[1].lower()
        if file_ext not in SUPPORT_FORMATS:
            continue  # 跳过不支持的文件
        
        # 生成 WebP 文件名（替换后缀为 .webp）
        webp_filename = os.path.splitext(filename)[0] + '.webp'
        webp_path = os.path.join(folder_path, webp_filename)
        
        try:
            # 打开图片文件
            with Image.open(file_full_path) as img:
                # 处理透明图片（保留 Alpha 通道）
                if img.mode in ('RGBA', 'LA'):
                    img.save(webp_path, 'WEBP', quality=quality, lossless=False, method=6)
                else:
                    # 普通图片高质量转换（JPG/GIF等无透明通道）
                    img.save(webp_path, 'WEBP', quality=quality, method=6)
            
            print(f"✅ 转换成功：{filename} → {webp_filename}")
        except Exception as e:
            print(f"❌ 转换失败：{filename}，错误：{str(e)}")

if __name__ == '__main__':
    # 替换为你的图片文件夹绝对路径
    # Windows示例：r"C:\Users\你的名字\Pictures"
    # Linux/Mac示例："/home/noi/hexo/source/images/ke1"
    FOLDER_PATH = '你的照片路径'
    # 需要先执行 "pip3 install pillow"
    # 质量参数（85 最优，90-95更清晰，80体积更小）
    QUALITY = 85
    
    # 检查文件夹是否存在
    if os.path.exists(FOLDER_PATH):
        convert_image_to_webp(FOLDER_PATH, QUALITY)
        print("\n🎉 所有支持的图片格式转换完成！")
    else:
        print(f"❌ 文件夹路径不存在：{FOLDER_PATH}，请检查路径是否正确！")
