const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./baza_i_funkcije/baza');

const app = express();
const PORT = 3000;

// Konfiguracija EJS-a
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // FIX: Ovdje smo dodali tačnu putanju

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'javno')));

app.use(session({
    secret: 'dfgdgdlkgdjl',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.use((req, res, next) => {
    res.locals.prijavljeniKorisnik = req.session.korisnik || null;
    next();
});

// https://expressjs.com/en/guide/routing.html

app.get('/', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');
    res.render('pocetna');
});

// NOVA RUTA: Endpoint za dohvatanje markera kao GeoJSON (specifikacija)
app.get('/api/markeri', (req, res) => {
    if (!req.session.korisnik) return res.json([]);

    try {
        // Uzimamo sva putovanja sa koordinatama
        const putovanja = db.prepare('SELECT id, naslov, lat, lng FROM putovanja WHERE lat IS NOT NULL AND lng IS NOT NULL').all();
        
        // Formatiramo podatke u GeoJSON format kako je trazeno u specifikaciji
        // (Izvor za format: https://geojson.org/)
        const geojson = {
            type: "FeatureCollection",
            features: putovanja.map(p => ({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [p.lng, p.lat] // Paziti: GeoJSON ide [longitude, latitude]
                },
                properties: {
                    naslov: p.naslov,
                    id: p.id
                }
            }))
        };
        
        res.json(geojson);
    } catch (err) {
        console.error(err);
        res.json({ type: "FeatureCollection", features: [] });
    }
});

// forma za login sa ispravnim renderom
app.get('/login', (req, res) => {
    res.render('login', { greska: null });
});

app.post('/login', (req, res) => {
    const { korisnicko_ime, lozinka } = req.body;
    
    // w3schools sql injection zastita korištenje ? parametara
    const korisnik = db.prepare('SELECT * FROM korisnici WHERE korisnicko_ime = ? OR email = ?').get(korisnicko_ime, korisnicko_ime);

    if (korisnik) {
        // Provjera hasha sa baze
        const lozinkaTacna = bcrypt.compareSync(lozinka, korisnik.lozinka);
        if (lozinkaTacna) {
            req.session.korisnik = korisnik;
            return res.redirect('/');
        }
    }
    // ako ne valja vratim nazad
    res.render('login', { greska: 'Pogrešno korisničko ime ili lozinka!' });
});

// forma za registraciju
app.get('/registracija', (req, res) => {
    res.render('registracija', { greska: null });
});

// registracija obrada (post)
app.post('/registracija', (req, res) => {
    const { tip_korisnika, ime_prezime_ili_naziv, korisnicko_ime, email, lozinka, lozinka_ponovno, datum_osnivanja } = req.body;

    if (lozinka !== lozinka_ponovno) {
        return res.render('registracija', { greska: 'Lozinke se ne poklapaju!' });
    }

    try {
        const hashLozinka = bcrypt.hashSync(lozinka, 10);
        const ubaci = db.prepare(`
            INSERT INTO korisnici (tip_korisnika, ime_prezime_ili_naziv, korisnicko_ime, email, lozinka, datum_osnivanja)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        ubaci.run(tip_korisnika, ime_prezime_ili_naziv, korisnicko_ime, email, hashLozinka, datum_osnivanja || null);
        
        res.redirect('/login');
    } catch (err) {
        // Ovo mi rjesava "SQLite: UNIQUE constraint error" ako account već ima u tabeli
        res.render('registracija', { greska: 'Korisničko ime ili email već postoji!' });
    }
});

// logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// zaboravljena lozinka, šalje u konzolu novu lozinku
app.post('/zaboravljena-lozinka', (req, res) => {
    const { email } = req.body;
    const korisnik = db.prepare('SELECT * FROM korisnici WHERE email = ?').get(email);
    
    if (korisnik) {
        const novaLozinka = 'NovaLozinka123'; // U praksi bi generisali random
        const hashLozinka = bcrypt.hashSync(novaLozinka, 10);
        db.prepare('UPDATE korisnici SET lozinka = ? WHERE email = ?').run(hashLozinka, email);
        
        console.log(`\n--- FAKE MAILER ---`);
        console.log(`Za: ${email}`);
        console.log(`Vaša nova lozinka je: ${novaLozinka}`);
        console.log(`-------------------\n`);
    }
    res.send('<a href="/login">Email poslat (pogledaj terminal). Nazad na login.</a>');
});

app.listen(PORT, () => {
    console.log(`Server sluša na portu http://localhost:${PORT}`);
});