import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

let nextId = 7;
const movies = [
  { id: 1, title: 'The Matrix',         director: 'The Wachowskis',  year: 1999, rating: 8.7 },
  { id: 2, title: 'Inception',          director: 'Christopher Nolan', year: 2010, rating: 8.8 },
  { id: 3, title: 'Parasite',           director: 'Bong Joon-ho',    year: 2019, rating: 8.5 },
  { id: 4, title: 'Spirited Away',      director: 'Hayao Miyazaki',  year: 2001, rating: 8.6 },
  { id: 5, title: 'Mad Max: Fury Road', director: 'George Miller',   year: 2015, rating: 8.1 },
  { id: 6, title: 'Dune: Part Two',     director: 'Denis Villeneuve', year: 2024, rating: 8.5 },
];

// GET /movies                  -> list all
// GET /movies?year=2019        -> filter by year
app.get('/movies', (req, res) => {
  const { year } = req.query;
  if (year) {
    const y = Number(year);
    return res.json(movies.filter((m) => m.year === y));
  }
  res.json(movies);
});

// GET /movies/:id -> single movie
app.get('/movies/:id', (req, res) => {
  const movie = movies.find((m) => m.id === Number(req.params.id));
  if (!movie) return res.status(404).json({ error: 'not found' });
  res.json(movie);
});

// POST /movies -> add a movie
app.post('/movies', (req, res) => {
  const { title, director, year, rating } = req.body ?? {};
  if (!title || !director || !year) {
    return res.status(400).json({ error: 'title, director, and year are required' });
  }
  const movie = {
    id: nextId++,
    title: String(title),
    director: String(director),
    year: Number(year),
    rating: rating != null ? Number(rating) : null,
  };
  movies.push(movie);
  res.status(201).json(movie);
});

// DELETE /movies/:id -> delete a movie
app.delete('/movies/:id', (req, res) => {
  const idx = movies.findIndex((m) => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const [removed] = movies.splice(idx, 1);
  res.json(removed);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Movies API listening on http://localhost:${PORT}`);
});
