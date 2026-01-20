#include <iostream>
#include <cstdlib>
#include <string>
#include <vector>

class WSL2Uninstaller {
private:
    bool isAdmin = false;

    // 检查是否以管理员权限运行
    bool checkAdminPrivileges() {
        std::cout << "检查管理员权限..." << std::endl;
        int result = system("net session >nul 2>&1");
        isAdmin = (result == 0);
        
        if (!isAdmin) {
            std::cout << "警告: 请以管理员权限运行此程序!" << std::endl;
            std::cout << "WSL2卸载需要管理员权限。" << std::endl;
        }
        return isAdmin;
    }

    // 执行命令并显示输出
    void executeCommand(const std::string& command, const std::string& description) {
        std::cout << "\n=== " << description << " ===" << std::endl;
        std::cout << "执行命令: " << command << std::endl;
        int result = system(command.c_str());
        
        if (result == 0) {
            std::cout << "? " << description << " 完成" << std::endl;
        } else {
            std::cout << "? " << description << " 失败 (代码: " << result << ")" << std::endl;
        }
    }

    // 显示警告信息
    void showWarning() {
        std::cout << "================================================" << std::endl;
        std::cout << "            WSL2 完全卸载工具" << std::endl;
        std::cout << "================================================" << std::endl;
        std::cout << "警告: 此操作将执行以下操作:" << std::endl;
        std::cout << "1. 停止所有WSL2实例" << std::endl;
        std::cout << "2. 注销所有WSL发行版" << std::endl;
        std::cout << "3. 卸载WSL2内核" << std::endl;
        std::cout << "4. 禁用Windows功能" << std::endl;
        std::cout << "5. 删除相关组件" << std::endl;
        std::cout << std::endl;
        std::cout << "这将删除所有WSL2数据和配置!" << std::endl;
        std::cout << "================================================" << std::endl;
        
        std::cout << "是否继续? (y/N): ";
        std::string input;
        std::getline(std::cin, input);
        
        if (input != "y" && input != "Y") {
            std::cout << "操作已取消。" << std::endl;
            exit(0);
        }
    }

public:
    void run() {
        // 显示警告
        showWarning();
        
        // 检查管理员权限
        if (!checkAdminPrivileges()) {
            std::cout << "程序退出。" << std::endl;
            return;
        }

        std::cout << "\n开始卸载WSL2..." << std::endl;

        // 步骤1: 停止所有WSL实例
        executeCommand("wsl --shutdown", "停止所有WSL实例");

        // 步骤2: 列出并注销所有WSL发行版
        executeCommand("wsl --list --verbose", "查看已安装的WSL发行版");
        
        // 获取所有发行版并逐个注销
        std::cout << "\n=== 注销所有WSL发行版 ===" << std::endl;
        std::vector<std::string> distributions = {
            "Ubuntu", "Debian", "kali-linux", "OpenSUSE-Leap", "SLES-12",
            "Alpine", "Fedora", "Pengwin", "Pengwin-Enterprise"
        };
        
        for (const auto& distro : distributions) {
            std::string command = "wsl --unregister " + distro + " >nul 2>&1";
            int result = system(command.c_str());
            if (result == 0) {
                std::cout << "? 已注销: " << distro << std::endl;
            }
        }

        // 尝试注销默认发行版
        executeCommand("wsl --unregister Ubuntu", "注销Ubuntu发行版");
        executeCommand("wsl --unregister Debian", "注销Debian发行版");
        executeCommand("wsl --unregister kali-linux", "注销Kali Linux发行版");

        // 步骤3: 卸载WSL2内核更新
        executeCommand("wsl --update --rollback", "回滚WSL内核更新");

        // 步骤4: 禁用Windows功能
        executeCommand("dism.exe /online /disable-feature /featurename:Microsoft-Windows-Subsystem-Linux /norestart", 
                      "禁用Windows Linux子系统功能");
        
        executeCommand("dism.exe /online /disable-feature /featurename:VirtualMachinePlatform /norestart", 
                      "禁用虚拟机平台");

        // 步骤5: 清理可能的残留文件
        std::cout << "\n=== 清理残留文件 ===" << std::endl;
        
        // 清理用户目录中的WSL相关文件
        executeCommand("rmdir /s /q \"%USERPROFILE%\\AppData\\Local\\Packages\\CanonicalGroupLimited*\" >nul 2>&1", 
                      "清理Ubuntu应用数据");
        
        executeCommand("rmdir /s /q \"%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps\\canonical*\" >nul 2>&1", 
                      "清理Windows应用链接");

        // 步骤6: 清理程序数据
        executeCommand("rmdir /s /q \"%ProgramFiles%\\WindowsApps\\Canonical*\" >nul 2>&1", 
                      "清理程序文件");

        // 步骤7: 重启WSL服务（如果存在）
        executeCommand("sc stop LxssManager >nul 2>&1", "停止LxssManager服务");
        executeCommand("sc config LxssManager start= disabled >nul 2>&1", "禁用LxssManager服务");

        std::cout << "\n================================================" << std::endl;
        std::cout << "            WSL2卸载完成!" << std::endl;
        std::cout << "================================================" << std::endl;
        std::cout << "建议操作:" << std::endl;
        std::cout << "1. 重启计算机以完成卸载过程" << std::endl;
        std::cout << "2. 检查是否还有WSL相关组件残留" << std::endl;
        std::cout << "3. 如需重新安装，请从Microsoft Store下载" << std::endl;
        std::cout << std::endl;
        
        std::cout << "验证卸载状态:" << std::endl;
        system("wsl --list --verbose");
        
        std::cout << "\n按Enter键退出...";
        std::cin.get();
    }
};

int main() {
    // 设置控制台编码为UTF-8以支持中文显示
    system("chcp 65001 >nul");
    
    WSL2Uninstaller uninstaller;
    uninstaller.run();
    
    return 0;
}