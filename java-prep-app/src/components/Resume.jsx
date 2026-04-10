const PROJECTS = [
  {
    title: "Fund Management & Superannuation Platform",
    location: "Melbourne · Global Fintech Provider",
    type: "Modular Monolith",
    tags: ["Java", "Spring", "Oracle DB", "Modular Monolith", "Superannuation"],
    description:
      "Large-scale wealth management and superannuation platform serving financial services clients across Australia and Asia-Pacific. Built as a well-structured modular monolith, the system handled fund administration, member lifecycle management, benefit calculations, and regulatory reporting. Integrated with superannuation clearing houses and government bodies, supporting complex contribution rules, preservation age logic, and pension drawdown workflows.",
  },
  {
    title: "Distributed Payments Platform",
    location: "Singapore · Global Banking Group",
    type: "Distributed System",
    tags: ["Java", "IBM MQ", "SWIFT", "PayNow", "Distributed Systems", "28 Countries"],
    description:
      "Core payment processing platform operating across 28 countries, supporting cross-border SWIFT transfers, domestic real-time payments, and interbank settlement. Integrated the banking core with Singapore's PayNow network using IBM MQ, with enhanced failover and automated reconciliation. The system processed high volumes of time-critical transactions under strict regulatory and SLA requirements.",
  },
  {
    title: "Investment Onboarding & Securities Platform",
    location: "Netherlands · Major European Bank",
    type: "DDD · Distributed System",
    tags: ["Java", "Spring Boot", "Kafka", "DDD", "Kubernetes", "Spring WebFlux"],
    description:
      "Domain-Driven Design based distributed platform for customer onboarding and securities management. Migrated from a synchronous batch architecture to an event-driven model using Kafka and Spring WebFlux, decoupling real-time onboarding flows from batch reconciliation. Led a cross-functional team across multiple squads, owning delivery from architecture through to production operations and incident response.",
  },
  {
    title: "Legal Intelligence Content Platform",
    location: "Netherlands · Global Legal Tech Provider",
    type: "Event-Driven Microservices",
    tags: ["Java", "Kafka", "Kafka Streams", "AWS EKS", "Hexagonal Architecture", "OpenTelemetry"],
    description:
      "Event-driven data streaming platform distributing regulatory and legal content across downstream services for a flagship legal intelligence product. Designed Domain-Driven microservices using Hexagonal Architecture — later adopted as the programme standard. Introduced contract-first API design with OpenAPI and Pact testing, and embedded security practices (OWASP, SAST/DAST, threat modelling) into CI/CD pipelines. Migrated services from AWS ECS to EKS.",
  },
];

const ACHIEVEMENTS = [
  "Migrated onboarding microservices to Spring WebFlux, boosting peak processing and cutting batch reconciliation time.",
  "Owned production incident response across an onboarding platform, coordinating cross-squad resolution of critical system failures.",
  "Migrated customer data synchronisation from TIBCO to an event-driven Kafka pipeline.",
  "Integrated a core banking system with Singapore's PayNow network using IBM MQ, improving reliability through enhanced failover and automated reconciliation.",
  "Set up distributed tracing using OpenTelemetry and Jaeger to make production issues easier to spot and debug.",
  "Migrated cloud services from AWS ECS to EKS, improving scalability and operational consistency.",
];

const SKILL_GROUPS = [
  { label: "Languages & Frameworks", skills: ["Java 25", "Kotlin", "Spring Boot 4", "Spring Cloud", "Spring AI", "WebFlux", "Reactor", "Spring Batch"] },
  { label: "Architecture",           skills: ["Microservices", "DDD", "Hexagonal", "Event-Driven", "Contract-First APIs"] },
  { label: "Messaging",              skills: ["Apache Kafka", "Kafka Streams", "IBM MQ"] },
  { label: "Cloud & DevOps",         skills: ["AWS", "EKS", "Docker", "Helm", "Azure DevOps", "CI/CD", "GitHub Copilot", "Claude Code"] },
  { label: "Databases",              skills: ["Amazon DynamoDB", "Oracle Database", "PostgreSQL", "MySQL"] },
  { label: "Testing",                skills: ["Pact", "OpenAPI", "Spock (BDD)", "Playwright (E2E)", "TDD"] },
  { label: "Observability",          skills: ["ELK", "Prometheus", "Grafana", "OpenTelemetry"] },
  { label: "Security",               skills: ["OWASP", "SAST/DAST", "Threat Modelling", "Secure SDLC"] },
  { label: "Regulatory",             skills: ["PSD2", "SWIFT", "3D Secure"] },
];

export default function Resume() {
  return (
    <div className="resume-page">
      <div className="resume-hero">
        <h1 className="resume-name">Tarun Bansal</h1>
        <p className="resume-tagline">Senior Backend Engineer · Distributed Systems & Cloud-Native Platforms</p>
        <div className="resume-contact">
          <span>📍 Amsterdam, Netherlands</span>
          <span>✉️ tbansal@outlook.com</span>
          <a className="resume-contact-link" href="https://www.linkedin.com/in/tarun-b-6035a25b/" target="_blank" rel="noreferrer">💼 LinkedIn</a>
          <a className="resume-contact-link" href="https://github.com/to-buss" target="_blank" rel="noreferrer">🐙 GitHub</a>
        </div>
      </div>

      <div className="resume-body">

        <section className="resume-section">
          <h2 className="resume-section-title">Summary</h2>
          <p className="resume-text">
            Senior Backend Engineer with 19+ years of experience building high-throughput distributed systems
            for banking, payments, and regulated financial platforms across Europe and APAC. Specialises in
            cloud-native microservices, event-driven architectures, and contract-first API platforms using
            Java, Spring Boot, Kafka, and Kubernetes. Proven track record leading system modernisation
            initiatives, improving reliability and throughput of production-critical systems, and embedding
            engineering quality practices — testing, observability, and security — within regulated environments.
          </p>
        </section>

        <section className="resume-section">
          <h2 className="resume-section-title">Experience</h2>
          <p className="resume-text">
            Across 19+ years, contributed to high-impact platforms spanning banking and payments, airline
            ground operations, regulatory content management, and wealth management. Designed and delivered
            onboarding, securities, and customer data sync platforms for large financial institutions;
            integrated core banking systems with real-time payment networks; built event-driven data pipelines
            for regulatory content distribution; and developed microservices supporting baggage tracking and
            passenger operations. Earlier career focused on wealth management and superannuation software
            for financial services clients across Australia and Asia-Pacific, and payroll and talent management
            products for enterprise clients in India.
          </p>
          <p className="resume-text" style={{ marginTop: "12px" }}>
            Held senior contract roles across the Netherlands (fintech, banking, regulatory tech, aviation)
            and permanent roles in Melbourne and India — consistently operating at lead or principal engineer
            level, owning delivery end-to-end across architecture, implementation, testing, and observability.
          </p>
        </section>

        <section className="resume-section">
          <h2 className="resume-section-title">Key Achievements</h2>
          <ul className="resume-bullets">
            {ACHIEVEMENTS.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </section>

        <section className="resume-section">
          <h2 className="resume-section-title">Key Projects</h2>
          <div className="resume-projects">
            {PROJECTS.map((p) => (
              <div key={p.title} className="resume-project-card">
                <div className="resume-project-header">
                  <div>
                    <span className="resume-project-title">{p.title}</span>
                    <span className="resume-project-meta"> · {p.location}</span>
                  </div>
                  <span className="resume-project-type">{p.type}</span>
                </div>
                <p className="resume-project-desc">{p.description}</p>
                <div className="resume-skills" style={{ marginTop: "10px" }}>
                  {p.tags.map((t) => <span key={t} className="resume-skill-tag">{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="resume-section">
          <h2 className="resume-section-title">Skills</h2>
          <div className="resume-skill-groups">
            {SKILL_GROUPS.map(({ label, skills }) => (
              <div key={label} className="resume-skill-group">
                <span className="resume-skill-group-label">{label}</span>
                <div className="resume-skills">
                  {skills.map((skill) => (
                    <span key={skill} className="resume-skill-tag">{skill}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="resume-section">
          <h2 className="resume-section-title">Education</h2>
          <div className="resume-job">
            <div className="resume-job-header">
              <div>
                <span className="resume-job-title">Bachelor of Technology — Information Technology</span>
                <span className="resume-job-company"> · Kurukshetra University, India</span>
              </div>
              <span className="resume-job-date">2002 – 2006</span>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}