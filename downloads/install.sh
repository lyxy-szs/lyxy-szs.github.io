# 1. 设置主机名
echo "lyxy-shi" > /etc/hostname

# 2. 设置hosts
cat > /etc/hosts << 'EOF'
127.0.0.1 localhost
127.0.1.1 lyxy-shi
EOF

# 3. 设置时区
ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# 4. 配置apt源（使用中科大镜像）
cat > /etc/apt/sources.list << 'EOF'
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy main restricted universe multiverse
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy-updates main restricted universe multiverse
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy-security main restricted universe multiverse
EOF

# 5. 更新并安装核心包
apt-get update
apt-get install -y --no-install-recommends \
    linux-image-generic \
    grub-efi-amd64 \
    systemd-sysv \
    netplan.io \
    wpasupplicant \
    wireless-tools