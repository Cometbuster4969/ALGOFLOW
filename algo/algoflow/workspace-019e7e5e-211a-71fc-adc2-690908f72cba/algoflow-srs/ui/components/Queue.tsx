/**
 * ============================================================================
 * AlgoFlow Spaced Repetition — Review Queue Component
 * ============================================================================
 *
 * Visual list of high-priority problems due for review.
 *
 * Features:
 *   • Priority-sorted list with urgency indicators
 *   • Color-coded difficulty badges
 *   • Overdue count prominently displayed
 *   • One-click "Start Review" flow
 *   • Rating submission with SM-2 feedback
 *   • Daily stats bar
 * ============================================================================
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DueProblem {
  problemId: number;
  externalId: string;
  platform: string;
  title: string;
  difficulty: "Easy" | "Med" | "Hard";
  tags: string[];
  url: string | null;
  easeFactor: number;
  intervalDays: number;
  repetitionCount: number;
  streakCorrect: number;
  nextReviewDate: string;
  daysOverdue: number;
  priority: number;
  lastRating: number | null;
  totalReviews: number;
}

interface DailyStats {
  reviewed: number;
  correct: number;
  incorrect: number;
  newProblems: number;
  avgEaseFactor: number;
}

interface ReviewResult {
  success: boolean;
  nextReviewDate: string;
  intervalDays: number;
  easeFactor: number;
  wasCorrect: boolean;
}

type Rating = 1 | 2 | 3 | 4 | 5;

// ─── API helpers ────────────────────────────────────────────────────────────

async function fetchDueProblems(limit = 50): Promise<{ count: number; problems: DueProblem[] }> {
  const res = await fetch(`/api/review/due?limit=${limit}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to fetch due problems");
  return res.json();
}

async function submitReview(problemId: number, rating: Rating): Promise<ReviewResult> {
  const res = await fetch("/api/review", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problem_id: problemId, rating }),
  });
  if (!res.ok) throw new Error("Failed to submit review");
  return res.json();
}

async function fetchDailyStats(): Promise<DailyStats> {
  const res = await fetch("/api/review/stats");
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

// ─── Rating labels ──────────────────────────────────────────────────────────

const RATING_OPTIONS: { value: Rating; label: string; emoji: string; color: string }[] = [
  { value: 1, label: "Total Lapse",   emoji: "😵", color: "#ef4444" },
  { value: 2, label: "Near Lapse",    emoji: "😟", color: "#f59e0b" },
  { value: 3, label: "Significant",   emoji: "😐", color: "#eab308" },
  { value: 4, label: "Minor Hesitate", emoji: "🙂", color: "#22c55e" },
  { value: 5, label: "Perfect",       emoji: "🎯", color: "#10b981" },
];

// ─── Queue Component ────────────────────────────────────────────────────────

export function ReviewQueue() {
  const [problems, setProblems] = useState<DueProblem[]>([]);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active review state
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [lastResult, setLastResult] = useState<ReviewResult | null>(null);

  // ── Fetch data on mount ──────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [dueData, statsData] = await Promise.all([
        fetchDueProblems(),
        fetchDailyStats(),
      ]);
      setProblems(dueData.problems);
      setStats(statsData);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Computed values ──────────────────────────────────────────────────

  const overdueCount = useMemo(
    () => problems.filter((p) => p.daysOverdue > 0).length,
    [problems]
  );

  const activeProblem = activeIndex !== null ? problems[activeIndex] : null;

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleStartReview = (index: number) => {
    setActiveIndex(index);
    setShowAnswer(false);
    setLastResult(null);
  };

  const handleSubmitRating = async (rating: Rating) => {
    if (!activeProblem) return;

    try {
      const result = await submitRating(activeProblem.problemId, rating);
      setLastResult(result);

      // Remove from list and advance
      setProblems((prev) => prev.filter((_, i) => i !== activeIndex));

      // Auto-advance to next after a brief pause
      setTimeout(() => {
        setProblems((current) => {
          if (current.length === 0) {
            setActiveIndex(null);
          } else {
            setActiveIndex((prev) => (prev !== null ? Math.min(prev, current.length - 1) : 0));
          }
          return current;
        });
        setShowAnswer(false);
        setLastResult(null);
      }, 1200);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Render: Loading ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading review queue…</div>
      </div>
    );
  }

  // ── Render: Error ────────────────────────────────────────────────────

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error}</div>
        <button style={styles.retryBtn} onClick={loadData}>Retry</button>
      </div>
    );
  }

  // ── Render: Empty ────────────────────────────────────────────────────

  if (problems.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyCard}>
          <div style={styles.emptyIcon}>✨</div>
          <h3 style={styles.emptyTitle}>All caught up!</h3>
          <p style={styles.emptyText}>No problems due for review today.</p>
        </div>
        {stats && <StatsBar stats={stats} />}
      </div>
    );
  }

  // ── Render: Active Review ────────────────────────────────────────────

  if (activeProblem) {
    return (
      <div style={styles.container}>
        <div style={styles.reviewCard}>
          {/* Header */}
          <div style={styles.reviewHeader}>
            <button
              style={styles.backBtn}
              onClick={() => setActiveIndex(null)}
            >
              ← Back to queue
            </button>
            <span style={styles.reviewCount}>
              {activeIndex! + 1} / {problems.length}
            </span>
          </div>

          {/* Problem info */}
          <div style={styles.problemInfo}>
            <DifficultyBadge difficulty={activeProblem.difficulty} />
            <span style={styles.platformTag}>{activeProblem.platform}</span>
          </div>
          <h2 style={styles.problemTitle}>{activeProblem.title}</h2>

          {activeProblem.tags.length > 0 && (
            <div style={styles.tagRow}>
              {activeProblem.tags.slice(0, 5).map((tag) => (
                <span key={tag} style={styles.tag}>{tag}</span>
              ))}
            </div>
          )}

          {/* SM-2 metadata */}
          <div style={styles.metaRow}>
            <span>EF: {activeProblem.easeFactor.toFixed(2)}</span>
            <span>Interval: {activeProblem.intervalDays}d</span>
            <span>Streak: {activeProblem.streakCorrect}🔥</span>
          </div>

          {/* Answer reveal */}
          {!showAnswer ? (
            <button
              style={styles.showAnswerBtn}
              onClick={() => setShowAnswer(true)}
            >
              Show Solution
            </button>
          ) : (
            <div style={styles.answerSection}>
              {activeProblem.url && (
                <a
                  href={activeProblem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.problemLink}
                >
                  Open problem ↗
                </a>
              )}

              {/* Rating buttons */}
              {!lastResult ? (
                <div style={styles.ratingSection}>
                  <p style={styles.ratingPrompt}>How well did you solve it?</p>
                  <div style={styles.ratingRow}>
                    {RATING_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        style={{
                          ...styles.ratingBtn,
                          borderColor: opt.color,
                        }}
                        onClick={() => handleSubmitRating(opt.value)}
                      >
                        <span style={styles.ratingEmoji}>{opt.emoji}</span>
                        <span style={styles.ratingLabel}>{opt.label}</span>
                        <span style={styles.ratingValue}>{opt.value}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={styles.resultCard}>
                  <div style={{
                    ...styles.resultIcon,
                    color: lastResult.wasCorrect ? "#10b981" : "#ef4444",
                  }}>
                    {lastResult.wasCorrect ? "✓ Correct" : "✗ Incorrect"}
                  </div>
                  <p style={styles.resultText}>
                    Next review: <strong>{lastResult.nextReviewDate}</strong>
                    {" · "}Interval: {lastResult.intervalDays}d
                    {" · "}EF: {lastResult.easeFactor.toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {stats && <StatsBar stats={stats} />}
      </div>
    );
  }

  // ── Render: Queue List ───────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.headerTitle}>
          Review Queue
          <span style={styles.badge}>{problems.length}</span>
        </h2>
        {overdueCount > 0 && (
          <span style={styles.overdueBadge}>
            {overdueCount} overdue
          </span>
        )}
      </div>

      {/* Problem list */}
      <div style={styles.list}>
        {problems.map((problem, index) => (
          <div
            key={problem.problemId}
            style={{
              ...styles.listItem,
              ...(problem.daysOverdue > 3 ? styles.listItemCritical : {}),
              ...(problem.daysOverdue > 0 ? styles.listItemOverdue : {}),
            }}
            onClick={() => handleStartReview(index)}
          >
            <div style={styles.listItemLeft}>
              <PriorityIndicator priority={problem.priority} />
              <div>
                <div style={styles.listItemTitle}>
                  <DifficultyBadge difficulty={problem.difficulty} small />
                  {problem.title}
                </div>
                <div style={styles.listItemMeta}>
                  {problem.platform} · EF {problem.easeFactor.toFixed(1)}
                  {problem.daysOverdue > 0 && (
                    <span style={styles.overdueText}>
                      {" "}· {problem.daysOverdue}d overdue
                    </span>
                  )}
                  {problem.streakCorrect > 0 && (
                    <span> · {problem.streakCorrect}🔥</span>
                  )}
                </div>
              </div>
            </div>
            <div style={styles.listItemRight}>
              <span style={styles.intervalBadge}>
                {formatInterval(problem.intervalDays)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {stats && <StatsBar stats={stats} />}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function DifficultyBadge({ difficulty, small = false }: { difficulty: string; small?: boolean }) {
  const colors: Record<string, string> = {
    Easy: "#10b981",
    Med: "#f59e0b",
    Hard: "#ef4444",
  };
  return (
    <span style={{
      ...styles.diffBadge,
      ...(small ? styles.diffBadgeSmall : {}),
      backgroundColor: colors[difficulty] || "#6b7280",
    }}>
      {difficulty}
    </span>
  );
}

function PriorityIndicator({ priority }: { priority: number }) {
  const level = priority > 200 ? "critical" : priority > 100 ? "high" : priority > 50 ? "medium" : "low";
  const colors: Record<string, string> = {
    critical: "#ef4444",
    high: "#f59e0b",
    medium: "#3b82f6",
    low: "#6b7280",
  };
  return (
    <div style={{
      ...styles.priorityDot,
      backgroundColor: colors[level],
    }} />
  );
}

function StatsBar({ stats }: { stats: DailyStats }) {
  const accuracy = stats.reviewed > 0
    ? Math.round((stats.correct / stats.reviewed) * 100)
    : 0;

  return (
    <div style={styles.statsBar}>
      <div style={styles.statItem}>
        <span style={styles.statValue}>{stats.reviewed}</span>
        <span style={styles.statLabel}>Reviewed</span>
      </div>
      <div style={styles.statItem}>
        <span style={{ ...styles.statValue, color: "#10b981" }}>{accuracy}%</span>
        <span style={styles.statLabel}>Accuracy</span>
      </div>
      <div style={styles.statItem}>
        <span style={styles.statValue}>{stats.newProblems}</span>
        <span style={styles.statLabel}>New</span>
      </div>
      <div style={styles.statItem}>
        <span style={styles.statValue}>{stats.avgEaseFactor.toFixed(2)}</span>
        <span style={styles.statLabel}>Avg EF</span>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatInterval(days: number): string {
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "16px 0",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#e4e6eb",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    fontSize: 12,
    fontWeight: 600,
    background: "#6366f1",
    color: "#fff",
    padding: "2px 8px",
    borderRadius: 10,
  },
  overdueBadge: {
    fontSize: 12,
    fontWeight: 600,
    background: "rgba(239,68,68,0.15)",
    color: "#ef4444",
    padding: "4px 10px",
    borderRadius: 8,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  listItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    background: "#161922",
    border: "1px solid #2a2d3a",
    borderRadius: 10,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  listItemOverdue: {
    borderLeft: "3px solid #f59e0b",
  },
  listItemCritical: {
    borderLeft: "3px solid #ef4444",
    background: "rgba(239,68,68,0.05)",
  },
  listItemLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  listItemTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#e4e6eb",
    display: "flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  listItemMeta: {
    fontSize: 12,
    color: "#8b8fa3",
    marginTop: 2,
  },
  overdueText: {
    color: "#f59e0b",
    fontWeight: 600,
  },
  listItemRight: {
    flexShrink: 0,
    marginLeft: 12,
  },
  intervalBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: "#8b8fa3",
    background: "#1c2030",
    padding: "3px 8px",
    borderRadius: 6,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  diffBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: "#fff",
    padding: "2px 6px",
    borderRadius: 4,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  diffBadgeSmall: {
    fontSize: 9,
    padding: "1px 4px",
  },
  // Review card
  reviewCard: {
    background: "#161922",
    border: "1px solid #2a2d3a",
    borderRadius: 12,
    padding: 24,
  },
  reviewHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "#8b8fa3",
    cursor: "pointer",
    fontSize: 13,
    padding: 0,
  },
  reviewCount: {
    fontSize: 12,
    color: "#8b8fa3",
  },
  problemInfo: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  platformTag: {
    fontSize: 11,
    color: "#8b8fa3",
    textTransform: "capitalize",
  },
  problemTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#e4e6eb",
    margin: "0 0 12px",
  },
  tagRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  tag: {
    fontSize: 11,
    color: "#8b8fa3",
    background: "#1c2030",
    padding: "2px 8px",
    borderRadius: 4,
  },
  metaRow: {
    display: "flex",
    gap: 16,
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 20,
    fontFamily: "monospace",
  },
  showAnswerBtn: {
    width: "100%",
    padding: "14px 0",
    fontSize: 15,
    fontWeight: 600,
    color: "#fff",
    background: "#6366f1",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  answerSection: {
    marginTop: 16,
  },
  problemLink: {
    display: "inline-block",
    color: "#6366f1",
    fontSize: 13,
    marginBottom: 16,
  },
  ratingSection: {
    marginTop: 16,
  },
  ratingPrompt: {
    fontSize: 14,
    color: "#8b8fa3",
    marginBottom: 12,
    textAlign: "center",
  },
  ratingRow: {
    display: "flex",
    gap: 8,
  },
  ratingBtn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "12px 8px",
    background: "#1c2030",
    border: "2px solid transparent",
    borderRadius: 10,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  ratingEmoji: {
    fontSize: 20,
  },
  ratingLabel: {
    fontSize: 10,
    color: "#8b8fa3",
    fontWeight: 600,
  },
  ratingValue: {
    fontSize: 11,
    color: "#6b7280",
  },
  resultCard: {
    textAlign: "center",
    padding: 16,
    background: "#1c2030",
    borderRadius: 10,
    marginTop: 16,
  },
  resultIcon: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  resultText: {
    fontSize: 13,
    color: "#8b8fa3",
  },
  // Stats
  statsBar: {
    display: "flex",
    justifyContent: "space-around",
    padding: "16px 0",
    marginTop: 16,
    borderTop: "1px solid #2a2d3a",
  },
  statItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "#e4e6eb",
  },
  statLabel: {
    fontSize: 11,
    color: "#6b7280",
  },
  // Empty state
  emptyCard: {
    textAlign: "center",
    padding: 48,
    background: "#161922",
    border: "1px solid #2a2d3a",
    borderRadius: 12,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#e4e6eb",
    margin: "0 0 8px",
  },
  emptyText: {
    fontSize: 14,
    color: "#8b8fa3",
  },
  loading: {
    textAlign: "center",
    padding: 48,
    color: "#8b8fa3",
  },
  error: {
    textAlign: "center",
    padding: 24,
    color: "#ef4444",
    background: "rgba(239,68,68,0.1)",
    borderRadius: 10,
    marginBottom: 12,
  },
  retryBtn: {
    display: "block",
    margin: "0 auto",
    padding: "8px 24px",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
};

export default ReviewQueue;
