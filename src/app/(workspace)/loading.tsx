export default function WorkspaceLoading() {
  return (
    <div className="module-page" aria-label="Loading page" aria-busy="true">
      <div className="skeleton" style={{ width: 190, height: 14 }} />
      <div className="skeleton" style={{ width: "42%", height: 38, marginTop: 18 }} />
      <div className="skeleton" style={{ width: "64%", height: 15, marginTop: 12 }} />
      <div className="skeleton-panel" style={{ height: 118, marginTop: 28 }} />
      <div className="skeleton-panel" style={{ height: 360, marginTop: 20 }} />
    </div>
  );
}
