import type { PairRequest } from "@/lib/types";

export function PairRequestList({ requests, busy, onRespond }: {
  requests: PairRequest[];
  busy: boolean;
  onRespond: (id: string, action: "accept" | "decline") => Promise<unknown>;
}) {
  return (
    <div className="request-list">
      {requests.length ? <>
        <p className="meta">Accepting shares both spaces’ schedules, commitments, notes and messages. If you both have a space, your partner’s shared preferences will apply.</p>
        {requests.map(request => (
          <div className="request-row" key={request.id}>
            <div><strong>{request.sender_name}</strong><span className="meta">@{request.sender_nickname}</span></div>
            <div className="request-actions">
              <button className="btn dark" disabled={busy} onClick={() => void onRespond(request.id, "accept")}>Accept request</button>
              <button className="plain" disabled={busy} onClick={() => void onRespond(request.id, "decline")}>Decline</button>
            </div>
          </div>
        ))}
      </> : <p className="muted">No pending requests yet. Your partner can send one using your nickname.</p>}
    </div>
  );
}

export function OutgoingPairRequestList({ requests, busy, onCancel }: {
  requests: PairRequest[];
  busy: boolean;
  onCancel: (requestId: string) => Promise<void>;
}) {
  return (
    <div className="request-list outgoing-requests">
      {requests.length ? requests.map((request) => (
        <div className="request-row" key={request.id}>
          <div>
            <strong>{request.recipient_name || "Your partner"}</strong>
            <span className="meta">@{request.recipient_nickname || "nickname"} · {request.status[0].toUpperCase() + request.status.slice(1)}</span>
          </div>
          {request.status === "pending" && (
            <button className="plain" disabled={busy} onClick={() => void onCancel(request.id)}>
              Cancel
            </button>
          )}
        </div>
      )) : <p className="muted">No sent requests.</p>}
    </div>
  );
}
