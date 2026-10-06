import { useState } from 'react';
import { Status } from './ui.jsx';

/** Kanban genérico com arrastar-e-soltar nativo. */
export function Kanban({ colunas, itens, colunaDe, onMover, renderCard, onAbrir }) {
  const [arrastando, setArrastando] = useState(null);
  const [sobre, setSobre] = useState(null);
  return (
    <div className="kanban">
      {colunas.map((col) => {
        const lista = itens.filter((i) => colunaDe(i) === col);
        return (
          <div key={col} className={`kcol ${sobre === col ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setSobre(col); }}
            onDragLeave={() => setSobre((s) => (s === col ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(null);
              const item = itens.find((i) => String(i.id) === e.dataTransfer.getData('text/plain'));
              if (item && colunaDe(item) !== col) onMover(item, col);
            }}>
            <div className="kcol-head"><Status s={col} /><span className="count-pill">{lista.length}</span></div>
            {lista.map((i) => (
              <div key={i.id} draggable className={`kcard ${i.atrasado ? 'atrasado' : ''} ${arrastando === i.id ? 'dragging' : ''}`}
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i.id)); setArrastando(i.id); }}
                onDragEnd={() => setArrastando(null)}
                onClick={() => onAbrir(i)}>
                {renderCard(i)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
