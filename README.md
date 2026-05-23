# MCP Demo — Movies

End-to-end learning project. Stage 1 is a plain REST API + React UI. Stage 2 (next) will add an MCP server on top of the same API so an LLM agent can query it.

## Layout

```
api/    Express REST API on http://localhost:3000
web/    React (Vite) UI on http://localhost:5173
```

## Run

In two terminals from this directory:

```sh
# terminal 1
cd api && npm install && npm start

# terminal 2
cd web && npm install && npm run dev
```

Then open http://localhost:5173.

## API endpoints

| Method | Path              | Description                          |
| ------ | ----------------- | ------------------------------------ |
| GET    | `/movies`         | List all (supports `?year=YYYY`)     |
| GET    | `/movies/:id`     | Get one movie                        |
| POST   | `/movies`         | Add a movie (JSON body)              |
| DELETE | `/movies/:id`     | Delete a movie                       |

Quick curl checks:

```sh
curl http://localhost:3000/movies
curl http://localhost:3000/movies?year=2019
curl http://localhost:3000/movies/1
curl -X POST http://localhost:3000/movies \
  -H 'content-type: application/json' \
  -d '{"title":"Arrival","director":"Denis Villeneuve","year":2016,"rating":7.9}'
curl -X DELETE http://localhost:3000/movies/2
```

Data is in-memory — restarting the API resets it.
