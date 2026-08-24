"use client";

import { useActionState } from "react";
import { CheckCircle2, Clock3, KeyRound, ShieldCheck, UserCheck, UserX } from "lucide-react";

import { LegalActionMessage } from "@/components/legal/legal-action-message";
import { getDateTimeFormatter } from "@/lib/intl-formatters";
import {
  attestLegalAccessReviewAction,
  completeLegalAccessReviewAction,
} from "@/modules/legal/actions/access-review";
import type { LegalAccessReviewActionState } from "@/modules/legal/schemas/access-review";
import type {
  LegalAccessReviewCampaignSummary,
  LegalAccessReviewItemSummary,
  LegalAccessReviewWorkspaceData,
} from "@/modules/legal/server/access-review";

const idle: LegalAccessReviewActionState = { status: "idle" };
const dateTime = getDateTimeFormatter("en", { dateStyle: "medium", timeStyle: "short" });

function sourceLabel(
  source: LegalAccessReviewItemSummary["permissions"][number]["sources"][number],
) {
  if (source.kind === "role") return `${source.roleName} role · ${source.scope}`;
  return `Explicit allow · ${source.scope ?? "resolved organization scope"}`;
}

function AttestationForm({
  campaignId,
  item,
}: {
  campaignId: string;
  item: LegalAccessReviewItemSummary;
}) {
  const [state, action, pending] = useActionState(attestLegalAccessReviewAction, idle);
  return (
    <form action={action} className="legal-access-review-form">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="snapshotDigest" value={item.snapshotDigest} />
      <label>
        Decision
        <select name="decision" defaultValue="retain">
          <option value="retain">Retain access</option>
          <option value="revoke">Revoke all snapshotted legal access</option>
        </select>
      </label>
      <label className="legal-access-review-form__rationale">
        Rationale
        <textarea
          name="rationale"
          rows={3}
          minLength={10}
          maxLength={1000}
          required
          placeholder="Explain why this legal access remains necessary or must be revoked."
        />
      </label>
      {item.isSelf ? (
        <label className="legal-checkbox legal-access-review-form__self">
          <input type="checkbox" name="selfReviewAcknowledged" required />I acknowledge that this is
          a self-review and that the evidence will record it permanently.
        </label>
      ) : null}
      <div className="legal-access-review-form__actions">
        <button className="button button--primary" type="submit" disabled={pending}>
          <UserCheck size={16} aria-hidden="true" /> Record attestation
        </button>
        <LegalActionMessage state={state} />
      </div>
    </form>
  );
}

function ReviewItem({
  campaign,
  item,
  canManage,
}: {
  campaign: LegalAccessReviewCampaignSummary;
  item: LegalAccessReviewItemSummary;
  canManage: boolean;
}) {
  return (
    <article className="legal-access-review-item">
      <header className="legal-access-review-item__header">
        <div>
          <h4>{item.subjectDisplayName}</h4>
          <p>{item.subjectEmail}</p>
        </div>
        <span className={`status-badge status-badge--${item.attestation?.decision ?? "pending"}`}>
          {item.attestation ? item.attestation.decision : "Pending attestation"}
        </span>
      </header>
      <details>
        <summary>
          <KeyRound size={15} aria-hidden="true" /> {item.permissionCount} sensitive legal
          permission{item.permissionCount === 1 ? "" : "s"}
        </summary>
        <ul className="legal-access-review-permissions">
          {item.permissions.map((permission) => (
            <li key={permission.permissionId}>
              <strong>{permission.key}</strong>
              <span>Effective scope: {permission.effectiveScope}</span>
              <small>
                {permission.sources.map(sourceLabel).join("; ") || "Effective source retained"}
              </small>
            </li>
          ))}
        </ul>
        <small className="legal-access-review-digest">
          Snapshot SHA-256: {item.snapshotDigest}
        </small>
      </details>
      {item.attestation ? (
        <div className="legal-access-review-attestation">
          {item.attestation.decision === "revoke" ? (
            <UserX size={18} aria-hidden="true" />
          ) : (
            <UserCheck size={18} aria-hidden="true" />
          )}
          <div>
            <strong>
              {item.attestation.decision === "revoke" ? "Access revoked" : "Access retained"}
              {item.attestation.selfReview ? " · Self-review" : ""}
            </strong>
            <p>{item.attestation.rationale}</p>
            <small>
              {item.attestation.reviewerName} ·{" "}
              {dateTime.format(new Date(item.attestation.attestedAt))} · SHA-256{" "}
              {item.attestation.attestationDigest}
            </small>
          </div>
        </div>
      ) : canManage && campaign.status !== "completed" ? (
        <AttestationForm campaignId={campaign.id} item={item} />
      ) : (
        <p className="legal-access-review-pending">Awaiting an authorized reviewer.</p>
      )}
    </article>
  );
}

function CompletionForm({ campaignId }: { campaignId: string }) {
  const [state, action, pending] = useActionState(completeLegalAccessReviewAction, idle);
  return (
    <form action={action} className="legal-access-review-complete">
      <input type="hidden" name="campaignId" value={campaignId} />
      <button className="button button--primary" type="submit" disabled={pending}>
        <CheckCircle2 size={16} aria-hidden="true" /> Seal completion evidence
      </button>
      <LegalActionMessage state={state} />
    </form>
  );
}

export function LegalAccessReviewWorkspace({ data }: { data: LegalAccessReviewWorkspaceData }) {
  return (
    <section
      className="legal-access-review-workspace"
      id="legal-access-reviews"
      aria-labelledby="legal-access-review-heading"
    >
      <div className="legal-workspace__toolbar">
        <div>
          <p className="eyebrow">Privileged access governance</p>
          <h2 id="legal-access-review-heading">Legal access reviews</h2>
          <p>
            Every {data.cadenceDays} days, AgencyOS snapshots effective sensitive legal access and
            its role or override sources. Reviewers have a {data.windowDays}-day window to attest
            retain or revoke decisions.
          </p>
        </div>
        <ShieldCheck size={24} aria-hidden="true" />
      </div>

      {data.campaigns.length ? (
        <div className="legal-access-review-campaigns">
          {data.campaigns.map((campaign) => (
            <article className="surface-card legal-access-review-campaign" key={campaign.id}>
              <header className="legal-access-review-campaign__header">
                <div>
                  <span className={`status-badge status-badge--${campaign.status}`}>
                    {campaign.status}
                  </span>
                  <h3>Review cycle {campaign.scheduledFor}</h3>
                  <p>
                    Opened {dateTime.format(new Date(campaign.openedAt))} · Due{" "}
                    {dateTime.format(new Date(campaign.dueAt))}
                  </p>
                </div>
                <div className="legal-access-review-progress">
                  <strong>
                    {campaign.attestedItemCount}/{campaign.snapshotItemCount}
                  </strong>
                  <span>attested</span>
                </div>
              </header>
              {campaign.items.length ? (
                <div className="legal-access-review-items">
                  {campaign.items.map((item) => (
                    <ReviewItem
                      key={item.id}
                      campaign={campaign}
                      item={item}
                      canManage={data.capabilities.canManage}
                    />
                  ))}
                </div>
              ) : (
                <div className="legal-access-review-empty">
                  <ShieldCheck size={20} aria-hidden="true" />
                  <p>No active membership held effective sensitive legal access at capture time.</p>
                </div>
              )}
              {campaign.completedAt ? (
                <footer className="legal-access-review-completion">
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <div>
                    <strong>Immutable completion evidence sealed</strong>
                    <p>
                      {campaign.retainCount} retained · {campaign.revokeCount} revoked ·{" "}
                      {campaign.selfReviewCount} self-reviewed · {campaign.completedByName}
                    </p>
                    <small>SHA-256: {campaign.evidenceDigest}</small>
                  </div>
                </footer>
              ) : campaign.canComplete ? (
                <CompletionForm campaignId={campaign.id} />
              ) : (
                <div className="legal-access-review-pending">
                  <Clock3 size={16} aria-hidden="true" /> Every item must have one immutable
                  attestation before completion evidence can be sealed.
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="surface-card empty-state">
          <Clock3 size={28} aria-hidden="true" />
          <h3>No legal access-review campaign yet</h3>
          <p>The bounded scheduler will open the first organization campaign automatically.</p>
        </div>
      )}
    </section>
  );
}
