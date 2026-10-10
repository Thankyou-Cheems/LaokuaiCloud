#include <windows.h>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <iomanip>

// Metadata and configured-key snapshots only. No hook, input injection or elevation.
static std::string json(const std::wstring& value) {
  std::ostringstream out;
  for (wchar_t c : value) {
    if (c == L'"' || c == L'\\') out << '\\' << static_cast<char>(c);
    else if (c >= 32 && c < 127) out << static_cast<char>(c);
    else out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<unsigned>(c);
  }
  return out.str();
}
static bool normalDesktop() {
  HDESK input = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  if (!input) return false;
  wchar_t active[256] = {}, current[256] = {};
  DWORD size = 0;
  bool ok = GetUserObjectInformationW(input, UOI_NAME, active, sizeof(active), &size)
    && GetUserObjectInformationW(GetThreadDesktop(GetCurrentThreadId()), UOI_NAME, current, sizeof(current), &size)
    && _wcsicmp(active, current) == 0;
  CloseDesktop(input);
  return ok;
}
int main(int argc, char** argv) {
  // Test mode never invokes Windows observation APIs.
  const bool fixture = argc == 2 && std::string(argv[1]) == "--fixture";
  std::vector<int> keys;
  if (!fixture) for (int i = 1; i < argc && i <= 12; ++i) {
    const int key = atoi(argv[i]);
    if (key > 0 && key <= 255) keys.push_back(key);
  }
  std::string command;
  while (std::getline(std::cin, command)) {
    if (command == "quit") break;
    if (fixture) {
      std::cout << "{\"valid\":true,\"path\":\"C:\\\\Fixture\\\\SquadGame\\\\Binaries\\\\Win64\\\\SquadGame-Win64-Shipping.exe\",\"down\":[66]}" << std::endl;
      continue;
    }
    DWORD pid = 0;
    HWND foreground = GetForegroundWindow();
    if (!normalDesktop() || !foreground || !GetWindowThreadProcessId(foreground, &pid)) {
      std::cout << "{\"valid\":false,\"path\":\"\",\"down\":[],\"reason\":\"desktop-unavailable\"}" << std::endl;
      continue;
    }
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    wchar_t path[32768]; DWORD length = 32768;
    const bool valid = process && QueryFullProcessImageNameW(process, 0, path, &length);
    if (process) CloseHandle(process);
    if (!valid) {
      std::cout << "{\"valid\":false,\"path\":\"\",\"down\":[],\"reason\":\"foreground-access-denied\"}" << std::endl;
      continue;
    }
    std::cout << "{\"valid\":true,\"path\":\"" << json(std::wstring(path, length)) << "\",\"down\":[";
    bool first = true;
    for (int key : keys) {
      bool down = (GetAsyncKeyState(key) & 0x8000) != 0;
      if (key == VK_LWIN) down = down || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;
      if (down) { if (!first) std::cout << ','; std::cout << key; first = false; }
    }
    std::cout << "]}" << std::endl;
  }
}
