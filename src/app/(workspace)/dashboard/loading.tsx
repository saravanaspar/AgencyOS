export default function DashboardLoading() {
  return (
    <div className="dashboard-page dashboard-page--live" aria-busy="true">
      <section className="page-heading">
        <div>
          <span className="skeleton skeleton--line" />
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--line" />
        </div>
      </section>
      <section className="dashboard-live-metrics">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="dashboard-live-metric" key={index}>
            <span className="skeleton skeleton--block" />
          </div>
        ))}
      </section>
      <div className="dashboard-live-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <section className="panel dashboard-live-section" key={index}>
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--block" />
          </section>
        ))}
      </div>
    </div>
  );
}
