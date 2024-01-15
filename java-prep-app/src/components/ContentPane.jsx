import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function ContentPane({ topic, subtopic, allSubtopics, onNavigate }) {
  const currentIdx = allSubtopics.findIndex((s) => s.id === subtopic.id);
  const prev = allSubtopics[currentIdx - 1] ?? null;
  const next = allSubtopics[currentIdx + 1] ?? null;

  // Detect code language
  const firstLine = subtopic.code?.trimStart() ?? "";
  const lang = firstLine.startsWith("-XX") || firstLine.startsWith("#") || firstLine.startsWith("kafka-")
    ? "bash"
    : "java";

  return (
    <div className="content-body">
      {/* breadcrumb + title */}
      <div className="content-header">
        <div className="content-breadcrumb">
          {topic.icon} {topic.title} <span>›</span> {subtopic.title}
        </div>
        <h1 className="content-title">{subtopic.title}</h1>
      </div>

      {/* subtopic pills */}
      <div className="subtopic-nav">
        {allSubtopics.map((s) => (
          <button
            key={s.id}
            className={`subtopic-pill ${s.id === subtopic.id ? "active" : ""}`}
            onClick={() => onNavigate(s.id)}
          >
            {s.title}
          </button>
        ))}
      </div>

      {/* description */}
      {subtopic.content && (
        <p className="content-description">{subtopic.content}</p>
      )}

      {/* diagram */}
      {subtopic.diagram && (
        <div className="diagram-block">
          <div className="diagram-label">Diagram</div>
          <pre>{subtopic.diagram}</pre>
        </div>
      )}

      {/* code */}
      {subtopic.code && (
        <div className="code-block">
          <div className="code-label">Code Example</div>
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            showLineNumbers
            wrapLongLines={false}
            customStyle={{ margin: 0, borderRadius: "8px", fontSize: "13px" }}
          >
            {subtopic.code.trim()}
          </SyntaxHighlighter>
        </div>
      )}

      {/* prev / next */}
      <div className="content-nav-footer">
        {prev ? (
          <button className="nav-btn prev" onClick={() => onNavigate(prev.id)}>
            <span className="nav-btn-label">← Previous</span>
            <span className="nav-btn-title">{prev.title}</span>
          </button>
        ) : <span />}

        {next ? (
          <button className="nav-btn next" onClick={() => onNavigate(next.id)}>
            <span className="nav-btn-label">Next →</span>
            <span className="nav-btn-title">{next.title}</span>
          </button>
        ) : <span />}
      </div>
    </div>
  );
}
