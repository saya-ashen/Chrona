/* Native acceptance probe only. Tests explicit breakaway and nested jobs,
 * beyond Node's detached/new-process-group flag. The inner job deliberately
 * has NO KILL_ON_JOB_CLOSE: cleanup must come from the guardian's outer job. */
#define _CRT_SECURE_NO_WARNINGS
#define _WIN32_WINNT 0x0A00
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
#include <stdlib.h>

static int mark(const wchar_t *root, const wchar_t *name, unsigned long value) {
  wchar_t path[32768];
  if (swprintf(path, 32768, L"%ls\\%ls", root, name) < 0) return 0;
  FILE *file = _wfopen(path, L"w");
  if (!file) return 0;
  fprintf(file, "%lu", value);
  return fclose(file) == 0;
}

int wmain(int argc, wchar_t **argv) {
  if (argc != 3) return 90;
  const wchar_t *root = argv[2];
  if (!wcscmp(argv[1], L"leaf")) {
    if (!mark(root, L"leaf", GetCurrentProcessId())) return 91;
    for (;;) { mark(root, L"leaf.heartbeat", GetTickCount()); Sleep(25); }
  }
  wchar_t exe[32768], line[32768];
  if (!GetModuleFileNameW(NULL, exe, 32768)) return 92;
  if (swprintf(line, 32768, L"\"%ls\" leaf \"%ls\"", exe, root) < 0) return 93;
  STARTUPINFOEXW startup = {0};
  PROCESS_INFORMATION child = {0};
  startup.StartupInfo.cb = sizeof(STARTUPINFOW);
  if (!wcscmp(argv[1], L"middle")) {
    /* The immediate nested job permits breakaway, but the outer guardian job
     * does not. This request may leave the inner job, never the outer one. */
    if (!CreateProcessW(exe, line, NULL, NULL, FALSE,
        CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        NULL, NULL, &startup.StartupInfo, &child)) return 106;
    CloseHandle(child.hThread); CloseHandle(child.hProcess);
    if (!mark(root, L"middle", GetCurrentProcessId()) || !mark(root, L"nested-breakaway", 1)) return 107;
    for (;;) { mark(root, L"middle.heartbeat", GetTickCount()); Sleep(25); }
  }
  BOOL escaped = CreateProcessW(exe, line, NULL, NULL, FALSE,
      CREATE_BREAKAWAY_FROM_JOB | CREATE_SUSPENDED, NULL, NULL, &startup.StartupInfo, &child);
  DWORD error = escaped ? 0 : GetLastError();
  if (escaped) {
    TerminateProcess(child.hProcess, 99);
    WaitForSingleObject(child.hProcess, 2000);
    CloseHandle(child.hThread); CloseHandle(child.hProcess);
  }
  if (!mark(root, L"breakaway-error", error) || escaped || error != ERROR_ACCESS_DENIED) return 94;
  HANDLE nested = CreateJobObjectW(NULL, NULL);
  if (!nested) return 95;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_BREAKAWAY_OK;
  if (!SetInformationJobObject(nested, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return 96;
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(NULL, 1, 0, &size);
  startup.lpAttributeList = malloc(size);
  if (!startup.lpAttributeList || !InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &size)) return 97;
  if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                                 &nested, sizeof(nested), NULL, NULL)) return 98;
  startup.StartupInfo.cb = sizeof(startup);
  if (swprintf(line, 32768, L"\"%ls\" middle \"%ls\"", exe, root) < 0) return 99;
  if (!CreateProcessW(exe, line, NULL, NULL, FALSE,
      EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
      NULL, NULL, &startup.StartupInfo, &child)) return 100;
  BOOL member = FALSE;
  if (!IsProcessInJob(child.hProcess, nested, &member) || !member) return 101;
  if (ResumeThread(child.hThread) == (DWORD)-1) return 102;
  CloseHandle(child.hThread); CloseHandle(child.hProcess);
  DeleteProcThreadAttributeList(startup.lpAttributeList); free(startup.lpAttributeList);
  if (!mark(root, L"task", GetCurrentProcessId())) return 103;
  wchar_t leaf[32768], marker[32768];
  if (swprintf(leaf, 32768, L"%ls\\leaf", root) < 0 ||
      swprintf(marker, 32768, L"%ls\\nested-breakaway", root) < 0) return 104;
  ULONGLONG deadline = GetTickCount64() + 5000;
  while (GetFileAttributesW(leaf) == INVALID_FILE_ATTRIBUTES ||
         GetFileAttributesW(marker) == INVALID_FILE_ATTRIBUTES) {
    if (GetTickCount64() >= deadline) return 105;
    Sleep(10);
  }
  if (!wcscmp(argv[1], L"exit")) { CloseHandle(nested); return 7; }
  for (;;) { mark(root, L"task.heartbeat", GetTickCount()); Sleep(25); }
}
