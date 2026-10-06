export default { join: (...p) => p.join('/'), resolve: (...p) => p.join('/'), extname: (n) => { const i = String(n).lastIndexOf('.'); return i > 0 ? String(n).slice(i) : ''; }, dirname: (p) => p };
