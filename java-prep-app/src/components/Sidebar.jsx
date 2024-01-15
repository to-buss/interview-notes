import { useState } from "react";

export default function Sidebar({ topics, activeTopic, activeSubtopic, onSelect, open }) {
  const [expanded, setExpanded] = useState(() => {
    const init = {};
    topics.forEach((t) => (init[t.id] = true));
    return init;
  });

  function toggle(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  if (!open) return <nav className="sidebar" />;

  return (
    <nav className="sidebar">
      {topics.map((topic) => (
        <div key={topic.id} className="sidebar-topic">
          <button
            className={`sidebar-topic-btn ${activeTopic === topic.id ? "active" : ""}`}
            onClick={() => toggle(topic.id)}
          >
            <span className="sidebar-topic-icon">{topic.icon}</span>
            {topic.title}
            <span className={`sidebar-chevron ${expanded[topic.id] ? "open" : ""}`}>▶</span>
          </button>

          {expanded[topic.id] && (
            <ul className="sidebar-subtopics">
              {topic.subtopics.map((sub) => (
                <li key={sub.id}>
                  <button
                    className={`sidebar-subtopic-btn ${
                      activeTopic === topic.id && activeSubtopic === sub.id ? "active" : ""
                    }`}
                    onClick={() => onSelect(topic.id, sub.id)}
                  >
                    {sub.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}
