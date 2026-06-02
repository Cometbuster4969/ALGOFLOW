const DEFAULT_TEMPLATES = [
  {
    name: "Fast I/O (C++)",
    language: "cpp",
    tags: ["io", "template"],
    body: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // your code
    return 0;
}
`,
  },
  {
    name: "DSU (C++)",
    language: "cpp",
    tags: ["dsu", "graphs"],
    body: `struct DSU {
    vector<int> p, r;
    DSU(int n) : p(n), r(n, 0) { iota(p.begin(), p.end(), 0); }
    int find(int x) { return p[x] == x ? x : p[x] = find(p[x]); }
    void unite(int a, int b) {
        a = find(a); b = find(b);
        if (a == b) return;
        if (r[a] < r[b]) swap(a, b);
        p[b] = a;
        if (r[a] == r[b]) r[a]++;
    }
};
`,
  },
  {
    name: "Dijkstra (C++)",
    language: "cpp",
    tags: ["graphs", "shortest-path"],
    body: `// adj: vector<vector<pair<int,int>>> dist
priority_queue<pair<long long,int>, vector<pair<long long,int>>, greater<>> pq;
vector<long long> dist(n, LLONG_MAX);
dist[s] = 0;
pq.push({0, s});
while (!pq.empty()) {
    auto [d, u] = pq.top(); pq.pop();
    if (d > dist[u]) continue;
    for (auto [v, w] : adj[u]) {
        if (dist[u] + w < dist[v]) {
            dist[v] = dist[u] + w;
            pq.push({dist[v], v});
        }
    }
}
`,
  },
  {
    name: "Python Fast I/O",
    language: "python",
    tags: ["io", "template"],
    body: `import sys
input = sys.stdin.readline

def main():
    pass

if __name__ == "__main__":
    main()
`,
  },
];

function seedDatabase(db) {
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get();
  if (userCount.c === 0) {
    db.prepare("INSERT INTO users (id, name) VALUES (1, 'Default')").run();
    db.prepare("INSERT INTO users (name) VALUES ('User 2')").run();
  }

  const tplCount = db.prepare("SELECT COUNT(*) AS c FROM templates").get();
  if (tplCount.c > 0) return;

  const insert = db.prepare(
    `INSERT INTO templates (user_id, name, language, tags, body)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (const t of DEFAULT_TEMPLATES) {
    insert.run(1, t.name, t.language, JSON.stringify(t.tags), t.body);
  }

  console.log("[AlgoFlow DB] Seeded default C++/Python templates");
}

module.exports = { seedDatabase, DEFAULT_TEMPLATES };
