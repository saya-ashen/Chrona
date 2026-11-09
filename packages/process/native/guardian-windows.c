/* Trusted-local Windows 10+ guardian. No PID lookup, shell, taskkill or service.
 * Only this helper owns the unnamed, non-inheritable Job handle. Its last close
 * kills members even if the helper is terminated. A private duplex named pipe
 * carries owner lifetime/cancel and bounded JSON status, never task output.
 * Atomic JOB_LIST assignment avoids the suspended-but-unassigned crash window.
 */
#define _WIN32_WINNT 0x0A00
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

static int write_record(HANDLE pipe, const char *text) {
  DWORD written = 0;
  DWORD size = (DWORD)strlen(text);
  return WriteFile(pipe, text, size, &written, NULL) && written == size;
}

static HANDLE connect_owner(const wchar_t *name) {
  ULONGLONG deadline = GetTickCount64() + 5000;
  do {
    HANDLE pipe = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, NULL,
                              OPEN_EXISTING, 0, NULL);
    if (pipe != INVALID_HANDLE_VALUE) {
      if (SetHandleInformation(pipe, HANDLE_FLAG_INHERIT, 0)) return pipe;
      CloseHandle(pipe);
      return INVALID_HANDLE_VALUE;
    }
    DWORD error = GetLastError();
    if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PIPE_BUSY) break;
    Sleep(10);
  } while (GetTickCount64() < deadline);
  return INVALID_HANDLE_VALUE;
}

/* Quote every argument using the Windows CRT argv rules, including empty
 * arguments, embedded quotes and trailing backslashes. Never invoke cmd.exe. */
static wchar_t *command_line(int argc, wchar_t **argv) {
  size_t capacity = 1;
  for (int i = 0; i < argc; i++) {
    size_t length = wcslen(argv[i]);
    if (length > 32767 || capacity + 2 * length + 3 > 32767) return NULL;
    capacity += 2 * length + 3;
  }
  wchar_t *line = calloc(capacity, sizeof(wchar_t));
  if (!line) return NULL;
  wchar_t *out = line;
  for (int i = 0; i < argc; i++) {
    if (i) *out++ = L' ';
    *out++ = L'"';
    const wchar_t *in = argv[i];
    for (;;) {
      size_t slashes = 0;
      while (*in == L'\\') { slashes++; in++; }
      size_t count = (*in == L'"' || *in == L'\0') ? 2 * slashes : slashes;
      for (size_t j = 0; j < count; j++) *out++ = L'\\';
      if (!*in) break;
      if (*in == L'"') *out++ = L'\\';
      *out++ = *in++;
    }
    *out++ = L'"';
  }
  *out = L'\0';
  return line;
}

static int owner_stop(HANDLE pipe, const char **reason) {
  DWORD available = 0;
  if (!PeekNamedPipe(pipe, NULL, 0, NULL, &available, NULL)) {
    DWORD error = GetLastError();
    *reason = error == ERROR_BROKEN_PIPE || error == ERROR_PIPE_NOT_CONNECTED
      ? "owner-exit" : "control-error";
    return 1;
  }
  if (available) { *reason = "cancel"; return 1; }
  return 0;
}

int wmain(int argc, wchar_t **argv) {
  if (argc < 5 || wcscmp(argv[1], L"--pipe") || wcscmp(argv[3], L"--")) return 125;
  HANDLE pipe = connect_owner(argv[2]);
  if (pipe == INVALID_HANDLE_VALUE) return 125;
  HANDLE job = CreateJobObjectW(NULL, NULL);
  HANDLE streams[3] = {NULL, NULL, NULL};
  PROCESS_INFORMATION task = {0};
  STARTUPINFOEXW startup = {0};
  wchar_t *line = NULL;
  int result = 125, attributes_initialized = 0;
  if (!job) goto done;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
  // Neither BREAKAWAY_OK nor SILENT_BREAKAWAY_OK is permitted.
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) goto done;
  if (!SetHandleInformation(job, HANDLE_FLAG_INHERIT, 0)) goto done;
  DWORD ids[3] = {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
  for (int i = 0; i < 3; i++) {
    if (!DuplicateHandle(GetCurrentProcess(), GetStdHandle(ids[i]), GetCurrentProcess(),
                         &streams[i], 0, TRUE, DUPLICATE_SAME_ACCESS)) goto done;
  }
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = streams[0];
  startup.StartupInfo.hStdOutput = streams[1];
  startup.StartupInfo.hStdError = streams[2];
  SIZE_T size = 0;
  InitializeProcThreadAttributeList(NULL, 2, 0, &size);
  startup.lpAttributeList = malloc(size);
  if (!startup.lpAttributeList || !InitializeProcThreadAttributeList(startup.lpAttributeList, 2, 0, &size)) goto done;
  attributes_initialized = 1;
  if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                 streams, sizeof(streams), NULL, NULL)) goto done;
  if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                                 &job, sizeof(job), NULL, NULL)) goto done;
  line = command_line(argc - 4, argv + 4);
  if (!line) goto done;
  const char *reason = "exit";
  if (owner_stop(pipe, &reason)) goto done;
  /* Assignment is part of CreateProcess, before any task thread can execute.
   * Unsupported JOB_LIST/nested-job constraints fail before launch; there is
   * deliberately no create-then-assign fallback with a crash gap. */
  if (!CreateProcessW(NULL, line, NULL, NULL, TRUE,
      CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
      NULL, NULL, &startup.StartupInfo, &task)) goto done;
  BOOL member = FALSE;
  if (!IsProcessInJob(task.hProcess, job, &member) || !member) goto done;
  if (owner_stop(pipe, &reason)) goto done;
  if (ResumeThread(task.hThread) == (DWORD)-1) goto done;
  CloseHandle(task.hThread); task.hThread = NULL;
  // Parent duplicates must not keep task output pipes alive after task exit.
  for (int i = 0; i < 3; i++) { CloseHandle(streams[i]); streams[i] = NULL; }
  char record[512];
  snprintf(record, sizeof(record), "{\"event\":\"ready\",\"version\":1,\"pid\":%lu,\"groupId\":%lu}\n",
           task.dwProcessId, task.dwProcessId);
  if (!write_record(pipe, record)) goto done;
  DWORD code = 0;
  int observed = 0;
  for (;;) {
    DWORD waited = WaitForSingleObject(task.hProcess, 10);
    if (waited == WAIT_OBJECT_0) {
      if (!GetExitCodeProcess(task.hProcess, &code)) { reason = "observation-error"; break; }
      observed = 1;
      break;
    }
    if (waited == WAIT_FAILED) { reason = "observation-error"; break; }
    if (owner_stop(pipe, &reason)) break;
  }
  /* The pinned job, not a PID list or notification, defines membership. No new
   * members can appear once all its processes have exited. Completion port
   * notifications alone are not guaranteed delivery and are not used as proof. */
  int terminated = TerminateJobObject(job, 137) != 0, empty = 0;
  ULONGLONG deadline = GetTickCount64() + 2000;
  do {
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting = {0};
    if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
                                   &accounting, sizeof(accounting), NULL)) break;
    if (accounting.ActiveProcesses == 0) { empty = 1; break; }
    Sleep(10);
  } while (GetTickCount64() < deadline);
  snprintf(record, sizeof(record),
    "{\"event\":\"exit\",\"code\":%lld,\"signal\":%d,\"reason\":\"%s\",\"groupStopped\":%s,\"descendantsStopped\":%s}\n",
    observed ? (long long)code : -1LL, observed ? 0 : 9, reason,
    terminated && empty ? "true" : "false", terminated && empty ? "true" : "false");
  write_record(pipe, record);
  result = observed && code < 256 ? (int)code : 0;
 done:
  // This also covers every error after suspended creation and before readiness.
  // Closing the last job handle is the kernel kill-on-close fallback; without
  // an exit record the wrapper MUST expose unknown, even if cleanup occurred.
  if (result == 125 && task.hProcess) TerminateProcess(task.hProcess, 125);
  if (task.hThread) CloseHandle(task.hThread);
  if (task.hProcess) CloseHandle(task.hProcess);
  if (job) CloseHandle(job);
  for (int i = 0; i < 3; i++) if (streams[i]) CloseHandle(streams[i]);
  if (attributes_initialized) DeleteProcThreadAttributeList(startup.lpAttributeList);
  free(startup.lpAttributeList);
  free(line);
  CloseHandle(pipe);
  return result;
}
