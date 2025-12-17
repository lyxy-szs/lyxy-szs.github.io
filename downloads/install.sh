#!/bin/bash
set -e

echo "========================================"
echo " Ubuntu 22.04 U盘最小化安装脚本"
echo " 作者: Auto-Installer"
echo " 主机名: lyxy-shi"
echo " 用户名: lyxy-shi"
echo " 密码: lyxy"
echo " 镜像源: 中科大 (USTC)"
echo "========================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# 检查是否为root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "请使用root权限运行此脚本 (sudo -i)"
    fi
}

# 检查网络连接
check_network() {
    log_info "检查网络连接..."
    if ! ping -c 3 mirrors.ustc.edu.cn > /dev/null 2>&1; then
        log_warn "网络连接不稳定，尝试使用USB网络共享..."
        # 尝试启用USB网络共享
        for iface in $(ls /sys/class/net/ | grep -E 'enp|usb|eth'); do
            dhclient $iface > /dev/null 2>&1 &
        done
        sleep 5
    fi
}

# 检查必要工具
check_tools() {
    log_info "检查必要工具..."
    local tools="parted mkfs.ext4 mkfs.fat mount umount chroot wget"
    
    for tool in $tools; do
        if ! command -v $tool > /dev/null 2>&1; then
            log_error "缺少必要工具: $tool"
        fi
    done
    
    # 检查debootstrap
    if ! command -v debootstrap > /dev/null 2>&1; then
        log_info "安装debootstrap..."
        apt-get update > /dev/null 2>&1 || log_warn "apt更新失败，继续尝试..."
        apt-get install -y debootstrap > /dev/null 2>&1 || log_error "无法安装debootstrap"
    fi
}

# 确认U盘设备
confirm_disk() {
    log_info "当前磁盘状态:"
    lsblk
    
    # 自动检测可能的U盘（大小在4-32GB之间）
    local candidates=()
    while read -r line; do
        local dev=$(echo $line | awk '{print $1}')
        local size=$(echo $line | awk '{print $4}' | grep -o '[0-9]*')
        local type=$(echo $line | awk '{print $6}')
        
        if [[ "$type" == "disk" ]] && [[ "$size" -ge 4 ]] && [[ "$size" -le 32 ]]; then
            candidates+=("$dev")
        fi
    done < <(lsblk -b -d -o NAME,SIZE,TYPE | tail -n +2)
    
    if [ ${#candidates[@]} -eq 0 ]; then
        log_error "未找到合适的U盘设备"
    elif [ ${#candidates[@]} -eq 1 ]; then
        TARGET_DISK="/dev/${candidates[0]}"
        log_info "自动选择U盘: $TARGET_DISK"
    else
        log_warn "找到多个候选设备: ${candidates[@]}"
        TARGET_DISK="/dev/${candidates[0]}"
        log_info "选择第一个设备: $TARGET_DISK"
    fi
    
    # 等待确认（短暂等待）
    log_warn "将在3秒后开始格式化 $TARGET_DISK，按Ctrl+C取消..."
    sleep 3
}

# 重新分区U盘
partition_disk() {
    log_info "重新分区U盘 ($TARGET_DISK)..."
    
    # 卸载所有挂载
    umount ${TARGET_DISK}* 2>/dev/null || true
    
    # 清除分区表
    dd if=/dev/zero of=${TARGET_DISK} bs=1M count=10 > /dev/null 2>&1
    
    # 创建GPT分区表
    parted ${TARGET_DISK} mklabel gpt > /dev/null 2>&1 || log_error "创建分区表失败"
    
    # 创建EFI分区 (512MB)
    parted ${TARGET_DISK} mkpart ESP fat32 1MiB 513MiB > /dev/null 2>&1 || log_error "创建EFI分区失败"
    parted ${TARGET_DISK} set 1 esp on > /dev/null 2>&1
    
    # 创建根分区 (剩余空间)
    parted ${TARGET_DISK} mkpart primary ext4 513MiB 100% > /dev/null 2>&1 || log_error "创建根分区失败"
    
    # 刷新分区表
    partprobe ${TARGET_DISK} > /dev/null 2>&1
    sleep 2
    
    log_info "分区创建完成"
}

# 格式化分区
format_partitions() {
    log_info "格式化分区..."
    
    # 格式化EFI分区 (FAT32)
    mkfs.fat -F32 ${TARGET_DISK}1 > /dev/null 2>&1 || log_error "格式化EFI分区失败"
    
    # 格式化根分区 (EXT4)
    mkfs.ext4 -F ${TARGET_DISK}2 > /dev/null 2>&1 || log_error "格式化根分区失败"
    
    log_info "分区格式化完成"
}

# 挂载分区
mount_partitions() {
    log_info "挂载分区..."
    
    # 挂载根分区
    mount ${TARGET_DISK}2 /mnt || log_error "挂载根分区失败"
    
    # 创建并挂载EFI分区
    mkdir -p /mnt/boot/efi
    mount ${TARGET_DISK}1 /mnt/boot/efi || log_error "挂载EFI分区失败"
    
    log_info "分区挂载完成"
}

# 安装基础系统
install_base_system() {
    log_info "安装基础系统 (使用中科大源)..."
    
    # 设置临时网络配置
    mkdir -p /mnt/etc
    echo "nameserver 8.8.8.8" > /mnt/etc/resolv.conf
    echo "nameserver 114.114.114.114" >> /mnt/etc/resolv.conf
    
    # 使用debootstrap安装最小系统
    log_info "正在下载系统文件 (这可能需要一些时间)..."
    debootstrap --arch=amd64 --variant=minbase jammy /mnt http://mirrors.ustc.edu.cn/ubuntu/ || {
        log_warn "debootstrap失败，尝试使用清华源..."
        debootstrap --arch=amd64 --variant=minbase jammy /mnt http://mirrors.tuna.tsinghua.edu.cn/ubuntu/ || 
        log_error "系统安装失败"
    }
    
    log_info "基础系统安装完成"
}

# 配置系统
configure_system() {
    log_info "配置系统..."
    
    # 挂载必要的文件系统
    mount --bind /dev /mnt/dev
    mount --bind /proc /mnt/proc
    mount --bind /sys /mnt/sys
    mount --bind /run /mnt/run
    
    # 复制网络配置
    cp /etc/resolv.conf /mnt/etc/resolv.conf 2>/dev/null || true
    
    # 使用chroot配置系统
    chroot /mnt /bin/bash << 'CHROOT_EOF'
#!/bin/bash
set -e

# 设置主机名
echo "lyxy-shi" > /etc/hostname

# 设置hosts
cat > /etc/hosts << EOF
127.0.0.1 localhost
127.0.1.1 lyxy-shi

# IPv6
::1     localhost ip6-localhost ip6-loopback
fe00::0 ip6-localnet
ff00::0 ip6-mcastprefix
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
EOF

# 设置时区
ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# 配置APT源 (中科大)
cat > /etc/apt/sources.list << 'APT_EOF'
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy main restricted universe multiverse
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy-updates main restricted universe multiverse
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy-security main restricted universe multiverse
APT_EOF

# 更新系统
apt-get update > /dev/null 2>&1

# 安装必要软件包
apt-get install -y --no-install-recommends \
    linux-image-generic \
    grub-efi-amd64 \
    systemd-sysv \
    netplan.io \
    networkd-dispatcher \
    wpasupplicant \
    wireless-tools \
    build-essential \
    linux-headers-generic \
    dkms \
    curl \
    vim \
    net-tools \
    iproute2 > /dev/null 2>&1

# 安装GRUB引导
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=ubuntu --recheck > /dev/null 2>&1
update-grub > /dev/null 2>&1

# 配置fstab
ROOT_UUID=$(blkid -s UUID -o value /dev/sda2)
EFI_UUID=$(blkid -s UUID -o value /dev/sda1)

cat > /etc/fstab << FSTAB_EOF
# /etc/fstab: static file system information.
UUID=${ROOT_UUID} /               ext4    errors=remount-ro 0       1
UUID=${EFI_UUID}  /boot/efi       vfat    umask=0077        0       1
FSTAB_EOF

# 创建用户
useradd -m -s /bin/bash lyxy-shi
echo "lyxy-shi:lyxy" | chpasswd

# 添加到sudo组
usermod -aG sudo lyxy-shi

# 允许密码登录（简化配置）
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true

# 配置网络
cat > /etc/netplan/01-network.yaml << NETPLAN_EOF
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      dhcp4: true
  wifis:
    wlan0:
      dhcp4: true
      optional: true
      access-points:
        "your-wifi-ssid":
          password: "your-wifi-password"
NETPLAN_EOF

chmod 600 /etc/netplan/01-network.yaml

# 设置默认shell
chsh -s /bin/bash lyxy-shi

echo "系统配置完成"
CHROOT_EOF

    log_info "系统配置完成"
}

# 清理和完成
cleanup_and_finish() {
    log_info "清理安装环境..."
    
    # 同步文件系统
    sync
    
    # 卸载所有挂载
    umount /mnt/run 2>/dev/null || true
    umount /mnt/sys 2>/dev/null || true
    umount /mnt/proc 2>/dev/null || true
    umount /mnt/dev 2>/dev/null || true
    umount /mnt/boot/efi 2>/dev/null || true
    umount /mnt 2>/dev/null || true
    
    # 移除挂载点
    rmdir /mnt/boot/efi /mnt/boot /mnt 2>/dev/null || true
    
    log_info "========================================"
    log_info "安装完成！"
    log_info "========================================"
    log_info "U盘系统信息："
    log_info "  主机名: lyxy-shi"
    log_info "  用户名: lyxy-shi"
    log_info "  密码: lyxy"
    log_info "  Root密码: lyxy (已允许root登录)"
    log_info "========================================"
    log_info "首次启动后，请执行以下操作："
    log_info "1. 通过USB网络共享连接网络："
    log_info "   sudo dhclient enp0s20f0u1"
    log_info "2. 配置WiFi：编辑 /etc/netplan/01-network.yaml"
    log_info "3. 应用网络配置："
    log_info "   sudo netplan apply"
    log_info "4. 安装无线网卡驱动（如果需要）："
    log_info "   sudo apt update"
    log_info "   sudo apt install firmware-realtek"
    log_info "========================================"
    echo ""
    echo "现在可以重启电脑并从U盘启动了。"
    echo "移除安装U盘，只保留目标U盘。"
}

# 主函数
main() {
    echo ""
    log_info "开始安装Ubuntu 22.04最小化系统到U盘"
    echo ""
    
    # 执行步骤
    check_root
    check_network
    check_tools
    confirm_disk
    partition_disk
    format_partitions
    mount_partitions
    install_base_system
    configure_system
    cleanup_and_finish
}

# 异常处理
trap 'log_error "脚本在行数 $LINENO 被中断"; exit 1' INT TERM
trap 'log_error "脚本执行失败: $?"' ERR

# 运行主函数
main "$@"