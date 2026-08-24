"use client";

import { Bot, CheckCircle2, Eraser, Send, ShieldCheck, Wrench } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  AiChatMessage,
  AiChatResponse,
  AiMode,
  AiProvider,
  AiProviderOption,
  AiToolTrace,
} from "@/modules/ai/ai";

interface DisplayMessage extends AiChatMessage {
  id: string;
  tools?: AiToolTrace[];
}

export function AiWorkspace({ providers }: { providers: AiProviderOption[] }) {
  const firstConfigured = providers.find((provider) => provider.configured) ?? providers[0];
  const [provider, setProvider] = useState<AiProvider>(firstConfigured.id);
  const [mode, setMode] = useState<AiMode>("operations");
  const activeProvider = useMemo(
    () => providers.find((candidate) => candidate.id === provider) ?? providers[0],
    [provider, providers],
  );
  const [model, setModel] = useState(firstConfigured.models[0] ?? "");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function changeProvider(next: AiProvider) {
    const option = providers.find((candidate) => candidate.id === next);
    setProvider(next);
    setModel(option?.models[0] ?? "");
    setError(null);
  }

  function changeMode(next: AiMode) {
    if (next === mode) return;
    setMode(next);
    setMessages([]);
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || pending || !activeProvider.configured) return;
    const userMessage: DisplayMessage = { id: crypto.randomUUID(), role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setPrompt("");
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          mode,
          messages: nextMessages
            .slice(-12)
            .map(({ role, content: text }) => ({ role, content: text })),
        }),
      });
      const data = (await response.json()) as AiChatResponse | { error?: string };
      if (!response.ok || !("message" in data)) {
        throw new Error("error" in data && data.error ? data.error : "AI request failed.");
      }
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.message,
          tools: data.tools,
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI request failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="ai-workspace" aria-label="AgencyOS AI workspace">
      <aside className="ai-workspace__rail" aria-label="AI configuration">
        <div>
          <h2>Model</h2>
          <p>Choose a configured provider. Keys stay on the server.</p>
        </div>
        <label className="field">
          <span>Mode</span>
          <select value={mode} onChange={(event) => changeMode(event.target.value as AiMode)}>
            <option value="operations">Operations assistant</option>
            <option value="executive">Executive analyst</option>
          </select>
        </label>
        <label className="field">
          <span>Provider</span>
          <select
            value={provider}
            onChange={(event) => changeProvider(event.target.value as AiProvider)}
          >
            {providers.map((option) => (
              <option key={option.id} value={option.id} disabled={!option.configured}>
                {option.label}
                {option.configured ? "" : " (not configured)"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            {activeProvider.models.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <div className="ai-workspace__trust">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>{mode === "executive" ? "Read-only executive tools" : "Permission-bound tools"}</strong>
            <span>
              {mode === "executive"
                ? "Executive analysis only receives an explicit allow-list of read tools and the canonical KPI catalogue."
                : "Every MCP call is authorized again. Sensitive mutations still require approval."}
            </span>
          </div>
        </div>
      </aside>

      <div className="ai-workspace__conversation">
        <div className="ai-workspace__toolbar">
          <div>
            <strong>{mode === "executive" ? "Executive analyst" : activeProvider.label}</strong>
            <span>{activeProvider.label} · {model}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            disabled={!messages.length || pending}
          >
            <Eraser size={15} aria-hidden="true" /> Clear conversation
          </Button>
        </div>

        <div className="ai-workspace__messages" aria-live="polite">
          {!messages.length ? (
            <div className="ai-workspace__empty">
              <Bot size={28} aria-hidden="true" />
              <h2>{mode === "executive" ? "Analyze the business" : "Ask about current operations"}</h2>
              <p>
                {mode === "executive"
                  ? "Ask why a KPI moved, which clients create concentration risk, what is driving margin or collections, or which decisions need attention. Executive mode is read-only."
                  : "Read the dashboard, search authorized records, review reports, manage calendar events, or inspect and update automations."}
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`ai-message ai-message--${message.role}`}>
                <div className="ai-message__label">
                  {message.role === "user" ? "You" : "AgencyOS AI"}
                </div>
                <p>{message.content}</p>
                {message.tools?.length ? (
                  <details className="ai-message__tools">
                    <summary>
                      <Wrench size={14} aria-hidden="true" /> {message.tools.length} tool action
                      {message.tools.length === 1 ? "" : "s"}
                    </summary>
                    <ul>
                      {message.tools.map((tool, index) => (
                        <li key={`${tool.tool}-${index}`}>
                          <CheckCircle2 size={14} aria-hidden="true" />
                          <span>
                            <strong>{tool.tool}</strong>
                            {tool.summary}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))
          )}
          {pending ? (
            <div className="ai-workspace__pending" role="status">
              Working with authorized AgencyOS tools…
            </div>
          ) : null}
        </div>

        <form className="ai-composer" onSubmit={submit}>
          {error ? (
            <p className="form-message form-message--error" role="alert">
              {error}
            </p>
          ) : null}
          {!activeProvider.configured ? (
            <p className="form-message form-message--error" role="alert">
              Configure {activeProvider.label} on the server before sending messages.
            </p>
          ) : null}
          <label htmlFor="ai-prompt" className="sr-only">
            Message AgencyOS AI
          </label>
          <textarea
            id="ai-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              mode === "executive"
                ? "Ask why a KPI moved, what is driving risk, or where to focus next"
                : "Ask about your dashboard, calendar, reports, automation, or records"
            }
            maxLength={12_000}
            rows={3}
            disabled={pending || !activeProvider.configured}
          />
          <Button type="submit" disabled={pending || !prompt.trim() || !activeProvider.configured}>
            <Send size={16} aria-hidden="true" /> {pending ? "Sending" : "Send message"}
          </Button>
          <span className="ai-composer__hint">Enter to send, Shift+Enter for a new line.</span>
        </form>
      </div>
    </section>
  );
}
