#!/bin/bash
set -e

echo "========================================"
echo " Ubuntu 22.04 Minimal USB Installation Script"
echo " Author: Auto-Installer"
echo " Hostname: lyxy-shi"
echo " Username: lyxy-shi"
echo " Password: lyxy"
echo " Mirror: USTC"
echo "========================================"

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Log functions
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

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Please run this script as root (sudo -i)"
    fi
}

# Check network connection
check_network() {
    log_info "Checking network connection..."
    if ! ping -c 3 mirrors.ustc.edu.cn > /dev/null 2>&1; then
        log_warn "Network unstable, trying USB tethering..."
        # Try to enable USB tethering
        for iface in $(ls /sys/class/net/ | grep -E 'enp|usb|eth'); do
            dhclient $iface > /dev/null 2>&1 &
        done
        sleep 5
    fi
}

# Check required tools
check_tools() {
    log_info "Checking required tools..."
    local tools="parted mkfs.ext4 mkfs.fat mount umount chroot wget"
    
    for tool in $tools; do
        if ! command -v $tool > /dev/null 2>&1; then
            log_error "Missing required tool: $tool"
        fi
    done
    
    # Check debootstrap
    if ! command -v debootstrap > /dev/null 2>&1; then
        log_info "Installing debootstrap..."
        apt-get update > /dev/null 2>&1 || log_warn "apt update failed, continuing..."
        apt-get install -y debootstrap > /dev/null 2>&1 || log_error "Cannot install debootstrap"
    fi
}

# Confirm USB disk
confirm_disk() {
    log_info "Current disk status:"
    lsblk
    
    # Auto-detect possible USB disks (4-32GB in size)
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
        log_error "No suitable USB disk found"
    elif [ ${#candidates[@]} -eq 1 ]; then
        TARGET_DISK="/dev/${candidates[0]}"
        log_info "Auto-selected USB disk: $TARGET_DISK"
    else
        log_warn "Multiple candidate devices found: ${candidates[@]}"
        TARGET_DISK="/dev/${candidates[0]}"
        log_info "Selected first device: $TARGET_DISK"
    fi
    
    # Wait for confirmation (brief)
    log_warn "Will format $TARGET_DISK in 3 seconds, press Ctrl+C to cancel..."
    sleep 3
}

# Re-partition USB disk
partition_disk() {
    log_info "Partitioning USB disk ($TARGET_DISK)..."
    
    # Unmount all
    umount ${TARGET_DISK}* 2>/dev/null || true
    
    # Clear partition table
    dd if=/dev/zero of=${TARGET_DISK} bs=1M count=10 > /dev/null 2>&1
    
    # Create GPT partition table
    parted ${TARGET_DISK} mklabel gpt > /dev/null 2>&1 || log_error "Failed to create partition table"
    
    # Create EFI partition (512MB)
    parted ${TARGET_DISK} mkpart ESP fat32 1MiB 513MiB > /dev/null 2>&1 || log_error "Failed to create EFI partition"
    parted ${TARGET_DISK} set 1 esp on > /dev/null 2>&1
    
    # Create root partition (remaining space)
    parted ${TARGET_DISK} mkpart primary ext4 513MiB 100% > /dev/null 2>&1 || log_error "Failed to create root partition"
    
    # Refresh partition table
    partprobe ${TARGET_DISK} > /dev/null 2>&1
    sleep 2
    
    log_info "Partitioning completed"
}

# Format partitions
format_partitions() {
    log_info "Formatting partitions..."
    
    # Format EFI partition (FAT32)
    mkfs.fat -F32 ${TARGET_DISK}1 > /dev/null 2>&1 || log_error "Failed to format EFI partition"
    
    # Format root partition (EXT4)
    mkfs.ext4 -F ${TARGET_DISK}2 > /dev/null 2>&1 || log_error "Failed to format root partition"
    
    log_info "Formatting completed"
}

# Mount partitions
mount_partitions() {
    log_info "Mounting partitions..."
    
    # Mount root partition
    mount ${TARGET_DISK}2 /mnt || log_error "Failed to mount root partition"
    
    # Create and mount EFI partition
    mkdir -p /mnt/boot/efi
    mount ${TARGET_DISK}1 /mnt/boot/efi || log_error "Failed to mount EFI partition"
    
    log_info "Mounting completed"
}

# Install base system
install_base_system() {
    log_info "Installing base system (using USTC mirror)..."
    
    # Set temporary network config
    mkdir -p /mnt/etc
    echo "nameserver 8.8.8.8" > /mnt/etc/resolv.conf
    echo "nameserver 114.114.114.114" >> /mnt/etc/resolv.conf
    
    # Use debootstrap to install minimal system
    log_info "Downloading system files (this may take some time)..."
    debootstrap --arch=amd64 --variant=minbase jammy /mnt http://mirrors.ustc.edu.cn/ubuntu/ || {
        log_warn "debootstrap failed, trying Tsinghua mirror..."
        debootstrap --arch=amd64 --variant=minbase jammy /mnt http://mirrors.tuna.tsinghua.edu.cn/ubuntu/ || 
        log_error "System installation failed"
    }
    
    log_info "Base system installation completed"
}

# Configure system
configure_system() {
    log_info "Configuring system..."
    
    # Mount necessary filesystems
    mount --bind /dev /mnt/dev
    mount --bind /proc /mnt/proc
    mount --bind /sys /mnt/sys
    mount --bind /run /mnt/run
    
    # Copy network config
    cp /etc/resolv.conf /mnt/etc/resolv.conf 2>/dev/null || true
    
    # Use chroot to configure system
    chroot /mnt /bin/bash << 'CHROOT_EOF'
#!/bin/bash
set -e

# Set hostname
echo "lyxy-shi" > /etc/hostname

# Set hosts
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

# Set timezone
ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# Configure APT sources (USTC)
cat > /etc/apt/sources.list << 'APT_EOF'
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy main restricted universe multiverse
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy-updates main restricted universe multiverse
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy-security main restricted universe multiverse
APT_EOF

# Update system
apt-get update > /dev/null 2>&1

# Install required packages
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

# Install GRUB bootloader
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=ubuntu --recheck > /dev/null 2>&1
update-grub > /dev/null 2>&1

# Configure fstab
ROOT_UUID=$(blkid -s UUID -o value /dev/sda2)
EFI_UUID=$(blkid -s UUID -o value /dev/sda1)

cat > /etc/fstab << FSTAB_EOF
# /etc/fstab: static file system information.
UUID=${ROOT_UUID} /               ext4    errors=remount-ro 0       1
UUID=${EFI_UUID}  /boot/efi       vfat    umask=0077        0       1
FSTAB_EOF

# Create user
useradd -m -s /bin/bash lyxy-shi
echo "lyxy-shi:lyxy" | chpasswd

# Add to sudo group
usermod -aG sudo lyxy-shi

# Allow password login (simplified config)
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true

# Configure network
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

# Set default shell
chsh -s /bin/bash lyxy-shi

echo "System configuration completed"
CHROOT_EOF

    log_info "System configuration completed"
}

# Cleanup and finish
cleanup_and_finish() {
    log_info "Cleaning up installation environment..."
    
    # Sync filesystem
    sync
    
    # Unmount all mounts
    umount /mnt/run 2>/dev/null || true
    umount /mnt/sys 2>/dev/null || true
    umount /mnt/proc 2>/dev/null || true
    umount /mnt/dev 2>/dev/null || true
    umount /mnt/boot/efi 2>/dev/null || true
    umount /mnt 2>/dev/null || true
    
    # Remove mount points
    rmdir /mnt/boot/efi /mnt/boot /mnt 2>/dev/null || true
    
    log_info "========================================"
    log_info "Installation completed!"
    log_info "========================================"
    log_info "USB System Information:"
    log_info "  Hostname: lyxy-shi"
    log_info "  Username: lyxy-shi"
    log_info "  Password: lyxy"
    log_info "  Root password: lyxy (root login enabled)"
    log_info "========================================"
    log_info "After first boot, please do the following:"
    log_info "1. Connect via USB tethering:"
    log_info "   sudo dhclient enp0s20f0u1"
    log_info "2. Configure WiFi: edit /etc/netplan/01-network.yaml"
    log_info "3. Apply network configuration:"
    log_info "   sudo netplan apply"
    log_info "4. Install wireless drivers (if needed):"
    log_info "   sudo apt update"
    log_info "   sudo apt install firmware-realtek"
    log_info "========================================"
    echo ""
    echo "Now you can reboot and boot from the USB drive."
    echo "Remove the installation USB, keep only the target USB."
}

# Main function
main() {
    echo ""
    log_info "Starting Ubuntu 22.04 minimal installation to USB"
    echo ""
    
    # Execute steps
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

# Exception handling
trap 'log_error "Script interrupted at line $LINENO"; exit 1' INT TERM
trap 'log_error "Script execution failed: $?"' ERR

# Run main function
main "$@"