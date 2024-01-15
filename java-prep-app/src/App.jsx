import { useState } from "react";
import Sidebar from "./components/Sidebar";
import ContentPane from "./components/ContentPane";
import { topics } from "./data/topics";
import { kafkaTopics } from "./data/kafka-topics";
import "./App.css";

const SUBJECTS = [
  { id: "java",  label: "Java",  data: topics },
  { id: "kafka", label: "Kafka", data: kafkaTopics },
];

function App() {
  const [subject, setSubject]               = useState("java");
  const [activeTopic, setActiveTopic]       = useState(topics[0].id);
  const [activeSubtopic, setActiveSubtopic] = useState(topics[0].subtopics[0].id);
  const [sidebarOpen, setSidebarOpen]       = useState(true);

  const currentSubjectData = SUBJECTS.find((s) => s.id === subject).data;
  const currentTopic       = currentSubjectData.find((t) => t.id === activeTopic);
  const currentSubtopic    = currentTopic?.subtopics.find((s) => s.id === activeSubtopic);

  function selectSubtopic(topicId, subtopicId) {
    setActiveTopic(topicId);
    setActiveSubtopic(subtopicId);
  }

  function switchSubject(newSubject) {
    const data = SUBJECTS.find((s) => s.id === newSubject).data;
    setSubject(newSubject);
    setActiveTopic(data[0].id);
    setActiveSubtopic(data[0].subtopics[0].id);
  }

  return (
    <div className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <header className="top-bar">
        <button className="menu-btn" onClick={() => setSidebarOpen((o) => !o)}>
          ☰
        </button>
        <span className="top-bar-title">Senior Interview Prep</span>
        <div className="subject-switcher">
          {SUBJECTS.map((s) => (
            <button
              key={s.id}
              className={`subject-btn ${subject === s.id ? "active" : ""}`}
              onClick={() => switchSubject(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="top-bar-badge">ING Ready</span>
      </header>

      <div className="body-layout">
        <Sidebar
          topics={currentSubjectData}
          activeTopic={activeTopic}
          activeSubtopic={activeSubtopic}
          onSelect={selectSubtopic}
          open={sidebarOpen}
        />
        <main className="content-area">
          {currentSubtopic && (
            <ContentPane
              topic={currentTopic}
              subtopic={currentSubtopic}
              allSubtopics={currentTopic.subtopics}
              onNavigate={(sid) => selectSubtopic(activeTopic, sid)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
