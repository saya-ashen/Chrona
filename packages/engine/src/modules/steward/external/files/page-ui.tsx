import { React, ui } from "/pages.js";
import type { PageHost } from "../web/src/registered-page";
type Entry = { path: string; name: string; kind: string };
type Listing = { parent: string | null; entries: Entry[]; truncated?: boolean };
type Document = { content?: string; truncated?: boolean };
function usePage(host: PageHost) {
  const [dir, setDir] = React.useState(""),
    [file, setFile] = React.useState(""),
    [list, setList] = React.useState<Listing>(),
    [doc, setDoc] = React.useState<Document>(),
    [error, setError] = React.useState(""),
    [pending, setPending] = React.useState(false),
    [revision, refresh] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    setList(undefined);
    void host
      .call<Listing>("list", { dir })
      .then((value) => {
        if (active) setList(value);
      })
      .catch((error) => {
        console.error(JSON.stringify({ component: "files", event: "list_failed", error: String(error) }));
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [dir, revision]);
  React.useEffect(() => {
    let active = true;
    setDoc(undefined);
    if (file)
      void host
        .call<Document>("read", { path: file })
        .then((value) => {
          if (active) setDoc(value);
        })
        .catch((error) => {
          console.error(JSON.stringify({ component: "files", event: "read_failed", error: String(error) }));
          if (active) setError(String(error));
        });
    return () => {
      active = false;
    };
  }, [file]);
  const changeDir = (dir: string) => {
    setDir(dir);
    setFile("");
    setError("");
  };
  const act = async (tool: string, args: Record<string, unknown>) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await host.call(tool, args);
      if (tool === "delete") setFile("");
      refresh((value) => value + 1);
      host.toast("已完成");
    } catch (error) {
      console.error(JSON.stringify({ component: "files", event: "write_failed", error: String(error) }));
      setError(String(error));
    } finally {
      setPending(false);
    }
  };
  return { list, doc, setDoc, file, setFile, error, pending, changeDir, act };
}
function Page({ host }: { host: PageHost }) {
  const { list, doc, setDoc, file, setFile, error, pending, changeDir, act } = usePage(host);
  return (
    <>
      <p role="alert" className="error">
        {error}
      </p>
      <ui.SplitPane
        sidebar={
          <ui.Card title="目录">
            {list?.parent !== null && list?.parent !== undefined ? (
              <ui.Button onClick={() => changeDir(list.parent!)}>← 上一级</ui.Button>
            ) : null}
            {!list ? (
              <p role="status">正在读取目录……</p>
            ) : (
              <ui.List empty="目录为空。">
                {list.entries
                  .filter((item) => item.name !== ".trash")
                  .map((item) => (
                    <ui.Button
                      key={item.path}
                      onClick={() => (item.kind === "directory" ? changeDir(item.path) : setFile(item.path))}
                    >
                      {item.name}
                      {item.kind === "directory" ? "/" : ""}
                    </ui.Button>
                  ))}
              </ui.List>
            )}
            {list?.truncated ? <p className="muted">列表过长，只显示了一部分。</p> : null}
          </ui.Card>
        }
      >
        {file ? (
          <ui.Card title={file}>
            {!doc ? (
              <p role="status">正在读取文件……</p>
            ) : doc.content === undefined ? (
              <p>不是文本文件，不能在这里查看</p>
            ) : (
              <>
                <ui.Markdown content={doc.content} />
                {doc.truncated ? (
                  <p>文档过长，只显示了开头，不能在这里修改</p>
                ) : (
                  <details>
                    <summary>编辑</summary>
                    <label className="ui-field">
                      内容
                      <textarea
                        rows={16}
                        value={doc.content}
                        onChange={(event) => setDoc({ ...doc, content: event.target.value })}
                      />
                    </label>
                    <ui.Button
                      disabled={pending}
                      onClick={() => void act("write", { path: file, content: doc.content })}
                    >
                      保存
                    </ui.Button>
                  </details>
                )}
              </>
            )}
            <ui.Button
              disabled={pending}
              onClick={() =>
                void host
                  .confirm({ title: "移到回收站", message: "文件和它的历史会移到 .trash，之后可以恢复。" })
                  .then((confirmed) => {
                    if (confirmed) void act("delete", { path: file });
                  })
              }
            >
              移到回收站
            </ui.Button>
          </ui.Card>
        ) : (
          <p className="muted">选择文件查看内容。</p>
        )}
      </ui.SplitPane>
    </>
  );
}
export default function mount(_element: HTMLElement, host: PageHost) {
  return host.render(<Page host={host} />);
}
