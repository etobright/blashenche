# Bright Jobs

MVP web: l'anti-LinkedIn pour les petits boulots.

Le principe est simple:

```text
Pas de CV. Pas de profil compliqué.
Écris comme tu parles, Bright comprend.
```

## Deux Interfaces

- `Je cherche`: le chercheur écrit une phrase naturelle comme `manevre bilongue demain payé journalier`.
- `J'embauche`: l'employeur écrit une phrase comme `besoin 3 gars chantier demain 7h bilongue 5000`.

Bright structure la demande, cherche dans la base locale, affiche les offres en cartes qui montent du bas, et permet de dire `Je suis intéressé` avec seulement un nom et un téléphone.

## Lancer

```powershell
cd C:\Users\pc\bright-ai\backend
npm run dev
```

Puis ouvrir:

```text
http://localhost:3001
```

## Fonctionnel Dans Le MVP

- Recherche naturelle tolérante aux fautes.
- Création d'offres par phrase simple.
- Base locale JSON dans `backend/data/jobs.json`.
- Candidature sans CV.
- Vue employeur avec les personnes intéressées.
- Design web mobile-first, noir luxe, rouge performance, touches métal/or.

## Endpoints

- `GET /api/jobs`
- `POST /api/jobs/search`
- `POST /api/jobs`
- `POST /api/jobs/:id/interest`
- `GET /api/employer/overview`
