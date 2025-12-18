#!/bin/bash
set -e

echo "========================================"
echo " Ubuntu 22.04 Minimal USB Installation"
echo " Author: Auto-Installer"
echo " Hostname: lyxy-shi"
echo " Username: lyxy-shi"
echo " Password: lyxy"
echo " Mirror: USTC (China)"
echo " Target Disk: /dev/sdb"
echo "========================================"

# Color definitions for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
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

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Verify root privileges
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root (use: sudo -i)"
    fi
}

# Check network connectivity
check_network() {
    log_step "Checking network connectivity..."
    if ! ping -c 3 mirrors.ustc.edu.cn > /dev/null 2>&1; then
        log_warn "Network connection unstable, attempting USB tethering..."
        # Try to enable USB network interfaces
        for iface in $(ls /sys/class/net/ | grep -E 'enp|usb|eth'); do
            dhclient $iface > /dev/null 2>&1 &
        done
        sleep 5
    fi
}

# Verify required tools are installed
check_tools() {
    log_step "Checking required tools..."
    local tools="parted mkfs.ext4 mkfs.fat mount umount chroot"
    
    for tool in $tools; do
        if ! command -v $tool > /dev/null 2>&1; then
            log_error "Missing required tool: $tool"
        fi
    done
    
    # Check for debootstrap
    if ! command -v debootstrap > /dev/null 2>&1; then
        log_info "Installing debootstrap..."
        apt-get update > /dev/null 2>&1 || log_warn "APT update failed, continuing..."
        apt-get install -y debootstrap > /dev/null 2>&1 || log_error "Failed to install debootstrap"
    fi
}

# Verify target disk exists
check_target_disk() {
    log_step "Verifying target disk /dev/sdb..."
    
    if [ ! -b /dev/sdb ]; then
        log_error "Target disk /dev/sdb not found"
    fi
    
    # Check disk size (should be around 8GB for USB 2.0)
    local size=$(blockdev --getsize64 /dev/sdb)
    local size_gb=$((size / 1000000000))
    
    if [ $size_gb -lt 4 ] || [ $size_gb -gt 32 ]; then
        log_warn "Disk size ($size_gb GB) seems unusual for target USB"
    fi
    
    log_info "Target disk confirmed: /dev/sdb (${size_gb}GB)"
    
    # Display disk information
    log_info "Current disk layout:"
    parted /dev/sdb print || true
    
    # Warning about data destruction
    log_warn "ALL DATA ON /dev/sdb WILL BE DESTROYED IN 5 SECONDS!"
    log_warn "Press Ctrl+C NOW to cancel..."
    sleep 5
}

# Unmount any existing partitions on target disk
unmount_existing() {
    log_step "Unmounting any existing partitions on /dev/sdb..."
    
    # Unmount all partitions of /dev/sdb
    for partition in $(lsblk -ln -o NAME /dev/sdb | grep -E '^sdb[0-9]+'); do
        umount "/dev/$partition" 2>/dev/null || true
    done
    
    # Also check for mount points in /mnt
    umount /mnt/boot/efi 2>/dev/null || true
    umount /mnt 2>/dev/null || true
    
    log_info "Unmounting complete"
}

# Create new partition table and partitions
create_partitions() {
    log_step "Creating new partition table on /dev/sdb..."
    
    # Destroy existing partition table
    dd if=/dev/zero of=/dev/sdb bs=1M count=10 > /dev/null 2>&1
    sync
    
    # Create GPT partition table
    parted /dev/sdb mklabel gpt > /dev/null 2>&1 || log_error "Failed to create GPT partition table"
    
    # Create EFI System Partition (512MB)
    log_info "Creating EFI partition (512MB)..."
    parted /dev/sdb mkpart ESP fat32 1MiB 513MiB > /dev/null 2>&1 || log_error "Failed to create EFI partition"
    parted /dev/sdb set 1 esp on > /dev/null 2>&1
    
    # Create root partition (remaining space)
    log_info "Creating root partition (remaining space)..."
    parted /dev/sdb mkpart primary ext4 513MiB 100% > /dev/null 2>&1 || log_error "Failed to create root partition"
    
    # Refresh partition table
    partprobe /dev/sdb > /dev/null 2>&1
    sleep 3
    
    log_info "Partition layout created successfully"
    
    # Display new partition table
    log_info "New partition table:"
    parted /dev/sdb print
}

# Format partitions with appropriate filesystems
format_partitions() {
    log_step "Formatting partitions..."
    
    # Format EFI partition as FAT32
    log_info "Formatting /dev/sdb1 as FAT32..."
    mkfs.fat -F32 /dev/sdb1 > /dev/null 2>&1 || log_error "Failed to format EFI partition"
    
    # Format root partition as EXT4
    log_info "Formatting /dev/sdb2 as EXT4..."
    mkfs.ext4 -F /dev/sdb2 > /dev/null 2>&1 || log_error "Failed to format root partition"
    
    log_info "Partition formatting complete"
}

# Mount partitions for installation
mount_partitions() {
    log_step "Mounting partitions..."
    
    # Create mount point if it doesn't exist
    mkdir -p /mnt
    
    # Mount root partition
    mount /dev/sdb2 /mnt || log_error "Failed to mount root partition"
    
    # Create and mount EFI directory
    mkdir -p /mnt/boot/efi
    mount /dev/sdb1 /mnt/boot/efi || log_error "Failed to mount EFI partition"
    
    log_info "Partitions mounted successfully"
}

# Install base system using debootstrap
install_base_system() {
    log_step "Installing base Ubuntu system..."
    
    # Create temporary DNS configuration
    mkdir -p /mnt/etc
    echo "nameserver 8.8.8.8" > /mnt/etc/resolv.conf
    echo "nameserver 114.114.114.114" >> /mnt/etc/resolv.conf
    
    log_info "Downloading base system from USTC mirror (this may take several minutes)..."
    
    # Attempt installation with USTC mirror
    if ! debootstrap --arch=amd64 --variant=minbase jammy /mnt http://mirrors.ustc.edu.cn/ubuntu/; then
        log_warn "USTC mirror failed, trying TUNA mirror..."
        if ! debootstrap --arch=amd64 --variant=minbase jammy /mnt http://mirrors.tuna.tsinghua.edu.cn/ubuntu/; then
            log_error "Failed to install base system from any mirror"
        fi
    fi
    
    log_info "Base system installation complete"
}

# Mount virtual filesystems for chroot
mount_virtual_fs() {
    log_step "Mounting virtual filesystems for chroot..."
    
    mount --bind /dev /mnt/dev
    mount --bind /proc /mnt/proc
    mount --bind /sys /mnt/sys
    mount --bind /run /mnt/run
    
    # Copy host DNS configuration
    cp /etc/resolv.conf /mnt/etc/resolv.conf 2>/dev/null || true
    
    log_info "Virtual filesystems mounted"
}

# Configure system inside chroot environment
configure_system() {
    log_step "Configuring system inside chroot environment..."
    
    # Execute configuration commands in chroot
    chroot /mnt /bin/bash << 'CHROOT_CONFIG'
#!/bin/bash
set -e

# Set hostname
echo "lyxy-shi" > /etc/hostname

# Configure hosts file
cat > /etc/hosts << 'HOSTS_EOF'
127.0.0.1 localhost
127.0.1.1 lyxy-shi

# IPv6 configuration
::1     localhost ip6-localhost ip6-loopback
fe00::0 ip6-localnet
ff00::0 ip6-mcastprefix
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
HOSTS_EOF

# Set timezone to Asia/Shanghai
ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# Configure APT sources (USTC mirror)
cat > /etc/apt/sources.list << 'APT_EOF'
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy main restricted universe multiverse
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy-updates main restricted universe multiverse
deb http://mirrors.ustc.edu.cn/ubuntu/ jammy-security main restricted universe multiverse
APT_EOF

# Update package lists
apt-get update > /dev/null 2>&1

# Install essential packages (minimal set)
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

# Install GRUB bootloader to USB disk
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=ubuntu --recheck > /dev/null 2>&1
update-grub > /dev/null 2>&1

# Configure fstab with partition UUIDs
ROOT_UUID=$(blkid -s UUID -o value /dev/sdb2)
EFI_UUID=$(blkid -s UUID -o value /dev/sdb1)

cat > /etc/fstab << FSTAB_EOF
# /etc/fstab: static file system information
UUID=${ROOT_UUID} /               ext4    errors=remount-ro 0       1
UUID=${EFI_UUID}  /boot/efi       vfat    umask=0077        0       1
FSTAB_EOF

# Create primary user
useradd -m -s /bin/bash lyxy-shi
echo "lyxy-shi:lyxy" | chpasswd

# Add user to sudo group
usermod -aG sudo lyxy-shi

# Enable password authentication for SSH (simplified)
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true

# Configure network with Netplan
cat > /etc/netplan/01-network.yaml << NETPLAN_EOF
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      dhcp4: true
      optional: true
  wifis:
    wlan0:
      dhcp4: true
      optional: true
      access-points:
        "your-wifi-ssid":
          password: "your-wifi-password"
NETPLAN_EOF

# Set secure permissions for netplan config
chmod 600 /etc/netplan/01-network.yaml

# Set default shell for user
chsh -s /bin/bash lyxy-shi

echo "System configuration completed inside chroot"
CHROOT_CONFIG

    log_info "Chroot configuration completed"
}

# Clean up installation environment
cleanup() {
    log_step "Cleaning up installation environment..."
    
    # Flush all filesystem buffers
    sync
    
    # Unmount virtual filesystems
    umount /mnt/run 2>/dev/null || true
    umount /mnt/sys 2>/dev/null || true
    umount /mnt/proc 2>/dev/null || true
    umount /mnt/dev 2>/dev/null || true
    
    # Unmount partitions
    umount /mnt/boot/efi 2>/dev/null || true
    umount /mnt 2>/dev/null || true
    
    # Remove mount directories
    rmdir /mnt/boot/efi /mnt/boot /mnt 2>/dev/null || true
    
    log_info "Cleanup completed"
}

# Display installation summary
show_summary() {
    log_step "Installation Summary"
    echo "========================================"
    log_info "Ubuntu 22.04 Minimal Installation Complete!"
    echo ""
    log_info "Target Disk: /dev/sdb"
    log_info "Partition Layout:"
    log_info "  /dev/sdb1: 512MB FAT32 (EFI System Partition)"
    log_info "  /dev/sdb2: Remaining space EXT4 (Root Filesystem)"
    echo ""
    log_info "System Configuration:"
    log_info "  Hostname: lyxy-shi"
    log_info "  Username: lyxy-shi"
    log_info "  Password: lyxy"
    log_info "  Root Login: Enabled (password: lyxy)"
    echo ""
    log_info "First Boot Instructions:"
    log_info "1. Remove installation USB, keep target USB connected"
    log_info "2. Boot from USB (may need to change BIOS boot order)"
    log_info "3. Login with username 'lyxy-shi' and password 'lyxy'"
    log_info "4. Connect to network:"
    log_info "   - Wired: Should work automatically"
    log_info "   - USB tethering: sudo dhclient enp0s20f0u1"
    log_info "   - WiFi: Edit /etc/netplan/01-network.yaml then: sudo netplan apply"
    log_info "5. Install wireless drivers if needed:"
    log_info "   sudo apt update && sudo apt install firmware-realtek firmware-iwlwifi"
    echo "========================================"
}

# Main installation function
main() {
    echo ""
    log_step "Starting Ubuntu 22.04 Minimal USB Installation"
    echo ""
    
    # Execute installation steps in sequence
    check_root
    check_network
    check_tools
    check_target_disk
    unmount_existing
    create_partitions
    format_partitions
    mount_partitions
    install_base_system
    mount_virtual_fs
    configure_system
    cleanup
    show_summary
}

# Set up error and interrupt handlers
trap 'log_error "Script interrupted at line $LINENO"; exit 1' INT TERM
trap 'log_error "Script failed with exit code: $?"' ERR

# Execute main function
main "$@"