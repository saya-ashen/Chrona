/* A trusted-local POSIX process-group guardian. No shell or service manager.
 * fd 3: owner lifetime/control pipe (any byte requests stop; EOF means owner died).
 * fd 4: bounded JSON status records. Both descriptors are closed before exec.
 * Keep the task leader waitable (WNOWAIT) until group signalling is complete:
 * its PID/PGID cannot be recycled while descendants still need cleanup.
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif

static void pause_ms(void) {
  struct timespec delay = {0, 10000000};
  nanosleep(&delay, NULL);
}

int main(int argc, char **argv) {
  if (argc < 2 || fcntl(3, F_GETFD) < 0 || fcntl(4, F_GETFD) < 0) return 125;
  int receipt = -1, receipt_dir = -1;
  const char *generation = NULL;
  if (argc > 1 && strcmp(argv[1], "--receipt") == 0) {
#ifndef __linux__
    return 125;
#else
    if (argc < 6 || strlen(argv[3]) != 64) return 125;
    for (int i = 0; i < 64; i++) if (!((argv[3][i] >= 'a' && argv[3][i] <= 'f') || (argv[3][i] >= '0' && argv[3][i] <= '9'))) return 125;
    char *parent = strdup(argv[2]);
    char *slash = strrchr(parent, '/');
    if (!slash) { free(parent); return 125; }
    *slash = 0;
    receipt_dir = open(parent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    free(parent);
    if (receipt_dir < 0) return 125;
    receipt = open(argv[2], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (receipt < 0 || fsync(receipt_dir) < 0) return 125;
    fcntl(receipt, F_SETFD, FD_CLOEXEC);
    fcntl(receipt_dir, F_SETFD, FD_CLOEXEC);
    generation = argv[3];
    argv += 4; argc -= 4;
#endif
  }
  signal(SIGPIPE, SIG_IGN);
  /* An ignored SIGCHLD can survive exec and would invalidate WNOWAIT/PID pinning. */
  signal(SIGCHLD, SIG_DFL);
  /* Owner cancellation goes through fd 3. Do not let a terminal/owner signal
   * bypass cleanup. SIGKILL of the guardian itself is outside this guarantee. */
  signal(SIGTERM, SIG_IGN);
  signal(SIGINT, SIG_IGN);
  signal(SIGHUP, SIG_IGN);
  fcntl(3, F_SETFD, FD_CLOEXEC);
  fcntl(4, F_SETFD, FD_CLOEXEC);
#ifdef __linux__
  /* All orphaned descendants, including setsid escapees, reparent here.
   * Refuse to launch if Linux child enumeration cannot be used. */
  if (prctl(PR_SET_CHILD_SUBREAPER, 1) < 0) return 125;
  char children_path[96];
  snprintf(children_path, sizeof(children_path), "/proc/self/task/%ld/children", (long)getpid());
  FILE *probe = fopen(children_path, "r");
  if (!probe) return 125;
  fclose(probe);
#endif
  pid_t task = fork();
  if (task < 0) return 125;
  if (task == 0) {
    if (receipt >= 0) close(receipt);
    if (receipt_dir >= 0) close(receipt_dir);
    close(3);
    close(4);
    signal(SIGPIPE, SIG_DFL);
    signal(SIGTERM, SIG_DFL);
    signal(SIGINT, SIG_DFL);
    signal(SIGHUP, SIG_DFL);
    if (setpgid(0, 0) < 0) _exit(125);
    execvp(argv[1], argv + 1);
    _exit(errno == ENOENT ? 127 : 126);
  }
  /* Child also sets the group before exec; EACCES means it won the race. */
  if (setpgid(task, task) < 0 && errno != EACCES) {
    kill(task, SIGKILL);
    waitpid(task, NULL, 0);
    return 125;
  }
  dprintf(4, "{\"event\":\"ready\",\"version\":1,\"pid\":%ld,\"groupId\":%ld}\n", (long)task, (long)task);
  const char *reason = "exit";
  int observed = 0;
  for (;;) {
    siginfo_t info = {0};
    if (waitid(P_PID, (id_t)task, &info, WEXITED | WNOHANG | WNOWAIT) < 0) {
      if (errno == EINTR) continue;
      reason = "observation-error";
      break;
    }
    if (info.si_pid == task) { observed = 1; break; }
    struct pollfd owner = {3, POLLIN | POLLHUP | POLLERR, 0};
    int result = poll(&owner, 1, 10);
    if (result < 0 && errno != EINTR) { reason = "control-error"; break; }
    if (result > 0) {
      char byte;
      ssize_t count = read(3, &byte, 1);
      if (count < 0 && errno == EINTR) continue;
      reason = count == 0 ? "owner-exit" : "cancel";
      break;
    }
  }
  int signalled = kill(-task, SIGKILL) == 0 || errno == ESRCH;
  int code = -1, sig = 0;
  int empty = 0, descendants_stopped = 0;
  /* Bound evidence collection. On Linux, repeatedly kill adopted children and
   * reap them until ECHILD. A child PID cannot be reused before we reap it.
   * Killing an escaped parent adopts its descendants here in the next pass. */
  for (int attempt = 0; attempt < 200; attempt++) {
#ifdef __linux__
    pid_t child;
    int status;
    do {
      child = waitpid(-1, &status, WNOHANG);
      if (child == task) {
        code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
        sig = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
      }
    } while (child > 0 || (child < 0 && errno == EINTR));
    if (child < 0 && errno == ECHILD) { descendants_stopped = 1; empty = 1; break; }
    FILE *children = fopen(children_path, "r");
    if (!children) break;
    long adopted;
    while (fscanf(children, "%ld", &adopted) == 1) {
      if (adopted > 0) kill((pid_t)adopted, SIGKILL);
    }
    fclose(children);
#else
    int status;
    if (waitpid(task, &status, WNOHANG) == task) {
      code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
      sig = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
    }
    if (kill(-task, 0) < 0 && errno == ESRCH) { empty = 1; break; }
#endif
    pause_ms();
  }
  if (receipt >= 0 && descendants_stopped) {
    if (dprintf(receipt, "{\"version\":1,\"generation\":\"%s\",\"state\":\"stopped\",\"scope\":\"descendants\",\"treeClean\":true}\n", generation) < 0 || fsync(receipt) < 0 || fsync(receipt_dir) < 0) return 125;
  }
  if (receipt >= 0) close(receipt);
  if (receipt_dir >= 0) close(receipt_dir);
  dprintf(4, "{\"event\":\"exit\",\"code\":%d,\"signal\":%d,\"reason\":\"%s\",\"groupStopped\":%s,\"descendantsStopped\":%s,\"observedExit\":%s}\n",
    code, sig, reason, signalled && empty ? "true" : "false", descendants_stopped ? "true" : "false", observed ? "true" : "false");
  return code >= 0 ? code : 128 + sig;
}
