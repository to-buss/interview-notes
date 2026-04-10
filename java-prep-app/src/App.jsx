import { useState } from "react";
import Sidebar from "./components/Sidebar";
import ContentPane from "./components/ContentPane";
import Resume from "./components/Resume";
import { topics } from "./data/topics";
import { kafkaTopics } from "./data/kafka-topics";
import "./App.css";

const SUBJECTS = [
  { id: "java",  label: "Java",  data: topics },
  { id: "kafka", label: "Kafka", data: kafkaTopics },
];

const PAGES = ["resume", "prep"];

function App() {
  const [page, setPage]                        = useState("resume");
  const [subject, setSubject]                  = useState("java");
  const [activeTopic, setActiveTopic]          = useState(topics[0].id);
  const [activeSubtopic, setActiveSubtopic]    = useState(topics[0].subtopics[0].id);
  const [sidebarOpen, setSidebarOpen]          = useState(true);

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

  function switchPage(newPage) {
    setPage(newPage);
    if (newPage === "prep") setSidebarOpen(true);
  }

  return (
    <div className={`app-shell ${sidebarOpen && page === "prep" ? "" : "sidebar-collapsed"}`}>
      <header className="top-bar">

        <nav className="page-nav">
          <button
            className={`page-nav-btn ${page === "resume" ? "active" : ""}`}
            onClick={() => switchPage("resume")}
          >
            About Me
          </button>
          <button
            className={`page-nav-btn ${page === "prep" ? "active" : ""}`}
            onClick={() => switchPage("prep")}
          >
            Prep Kit
          </button>
        </nav>
      </header>

      <div className={`sub-bar ${page === "prep" ? "sub-bar-visible" : ""}`}>
        <button className="menu-btn" onClick={() => setSidebarOpen((o) => !o)}>
          ☰
        </button>
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
      </div>

      {page === "resume" ? (
        <main className="resume-area">
          <Resume />
        </main>
      ) : (
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
      )}
    </div>
  );
}

export default App;