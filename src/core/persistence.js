import Dexie from 'dexie';

export const db = new Dexie('CabijOS');

// Define database schema for the foundation phase
db.version(1).stores({
  recipes: '++id, name, sku, category',
  tasks: '++id, title, status, priority, dueDate',
  inventory: 'sku, name, quantity, unit',
  logs: '++id, timestamp, level, message'
});

export const initDB = async () => {
  try {
    await db.open();
    console.log('Cabij OS: Persistence Layer Synchronized (Dexie)');
  } catch (err) {
    console.error('Failed to open database:', err);
  }
};
