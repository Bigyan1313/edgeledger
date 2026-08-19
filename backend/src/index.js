import app from './app.js'

// Hosts (Render, etc.) inject their own port via process.env.PORT.
const PORT = process.env.PORT || 3001

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
