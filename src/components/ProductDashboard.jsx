// src/components/ProductDashboard.jsx
import { memo } from 'react';
import { FixedSizeList as List } from 'react-window';
import { create } from 'zustand';

const TOTAL_PRODUCTS = 5000;
const ROW_HEIGHT = 50;

function createInitialProducts(total) {
  const ids = [];
  const byId = {};

  for (let i = 0; i < total; i++) {
    const id = `prod_${i}`;
    ids.push(id);
    byId[id] = { id, name: `Produk ${i}`, stock: 10 };
  }

  return { ids, byId };
}

const useProductStore = create((set) => ({
  ...createInitialProducts(TOTAL_PRODUCTS),

  decreaseStock: (id) =>
    set((state) => {
      const product = state.byId[id];
      if (product.stock <= 0) return state;

      return {
        byId: {
          ...state.byId,
          [id]: { ...product, stock: product.stock - 1 },
        },
      };
    }),
}));

const ProductRow = memo(function ProductRow({ index, style }) {
  const id = useProductStore((state) => state.ids[index]);
  const product = useProductStore((state) => state.byId[id]);
  const decreaseStock = useProductStore((state) => state.decreaseStock);

  return (
    <div style={style} className="flex items-center justify-between border-b p-2">
      <span>
        {product.name} (Stok: {product.stock})
      </span>
      <button
        onClick={() => decreaseStock(id)}
        disabled={product.stock === 0}
        className="rounded bg-blue-500 px-3 py-1 text-white disabled:bg-gray-300"
      >
        {product.stock === 0 ? 'Habis' : 'Kurangi Stok'}
      </button>
    </div>
  );
});

export default function ProductDashboard() {
  const totalItems = useProductStore((state) => state.ids.length);

  return (
    <div className="p-4">
      <h2>Dashboard Produk ({totalItems} Item)</h2>
      <List height={600} width="100%" itemCount={totalItems} itemSize={ROW_HEIGHT}>
        {ProductRow}
      </List>
    </div>
  );
}