import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import legalLensMd from "../data/legallens.md?raw";

export default function LegalLens() {
  return (
    <div className="legallens-page">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{legalLensMd}</ReactMarkdown>
    </div>
  );
}