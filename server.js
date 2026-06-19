const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const db = require('./baza_i_funkcije/baza');

const app = express();
const PORT = 3000;

// ubacim default inicijalizaciju
app.set('view engine', 'ejs');
app.set('views');

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
    
    // zavrsena putovanja (sva koja su prije danas) za dropdown meni na mapi
    const zavrsenaPutovanja = db.prepare("SELECT id, naslov, lat, lng FROM putovanja WHERE datum < date('now') AND lat IS NOT NULL").all();
    
    res.render('pocetna', { zavrsenaPutovanja });
});

// forma za dodavanje putovanja
app.get('/dodaj-putovanje', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');
    
    // trebaju nam sve agencije za listu da bi ih korisnik mogao odabrati
    const agencije = db.prepare("SELECT id, ime_prezime_ili_naziv FROM korisnici WHERE tip_korisnika = 'agencija'").all();
    
    // dodajemo lat i lng iz URL query parametara (koji dođu sa klika mape)
    res.render('dodaj-putovanje', { 
        agencije: agencije,
        lat: req.query.lat || '', 
        lng: req.query.lng || ''
    });
});

// obrada dodavanja putovanja (POST)
app.post('/dodaj-putovanje', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');

    const { naslov, opis, datum, tip_putovanja, prevoz, cijena, lat, lng, agencija_id } = req.body;

    // ako dodaje agencija, ona kreira za sebe, a ako dodaje osoba, koristi se odabrani agencija_id
    // vidio sam da preporučuju da se koristi ovo https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Conditional_operator
    // pa sam prekopirao tako kod
    const stvarnaAgencijaId = req.session.korisnik.tip_korisnika === 'agencija' ? req.session.korisnik.id : agencija_id;

    // ubacujemo u bazu novo putovanje
    const ubaci = db.prepare(`
        INSERT INTO putovanja (naslov, opis, datum, tip_putovanja, prevoz, cijena, lat, lng, agencija_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const rezultat = ubaci.run(naslov, opis, datum, tip_putovanja, prevoz, cijena, lat, lng, stvarnaAgencijaId);

    // ako je korisnik taj koji pravi putovanje, automatski ga pišemo u tabelu "prijave", gdje mu
    // status ide na "na cekanju" (ovo ce agencija poslije vidjeti kao zahtjev)
    if (req.session.korisnik.tip_korisnika === 'osoba') {
        db.prepare(`INSERT INTO prijave (korisnik_id, putovanje_id, status) VALUES (?, ?, 'na cekanju')`)
          .run(req.session.korisnik.id, rezultat.lastInsertRowid); // lastInsertRowid vraca ID zadnjeg inserta iz SQLite-a
    }

    res.redirect('/moja-putovanja');
});

// moja putovanja (sa osnovnom pretragom i sortiranjem)
app.get('/moja-putovanja', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');

    // defaultne vrijednosti iz URL-a (stackOverflow question: object destructuring za req.query #71919542)
    const { pretraga = '', sort = 'datum' } = req.query; 

    let upit = "";
    let parametri = [];
    // https://www.sqlitetutorial.net/sqlite-like/
    const poljeZaPretragu = `%${pretraga}%`; // SQLite format za LIKE '%string%'

    if (req.session.korisnik.tip_korisnika === 'agencija') {
        // agencija vidi sva svoja kreirana putovanja
        upit = `SELECT * FROM putovanja WHERE agencija_id = ? AND naslov LIKE ? ORDER BY ${sort} ASC`;
        parametri = [req.session.korisnik.id, poljeZaPretragu];
    } else {
        // osoba vidi putovanja na koja je prijavljeno (JOIN na tabelu prijave)
        upit = `
            SELECT p.*, pr.status 
            FROM putovanja p 
            JOIN prijave pr ON p.id = pr.putovanje_id 
            WHERE pr.korisnik_id = ? AND p.naslov LIKE ?
            ORDER BY p.${sort} ASC
        `;
        parametri = [req.session.korisnik.id, poljeZaPretragu];
    }

    const putovanja = db.prepare(upit).all(...parametri);

    res.render('moja-putovanja', { 
        putovanja: putovanja, 
        pretraga: pretraga, 
        sort: sort 
    });
});

// -- planirana putovanja --
app.get('/planirana-putovanja', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');
    
    const { pretraga = '', sort = 'datum' } = req.query; 
    const poljeZaPretragu = `%${pretraga}%`;
    
    const danas = new Date().toISOString().split('T')[0]; 

    let dostupnaPutovanja = []; 
    let mojePrijave = []; 
    let listaZaAgenciju = []; 

    if (req.session.korisnik.tip_korisnika === 'osoba') {
        // putovanja na koja se može prijaviti (buduća, organizovana) a da već nije prijavljen (W3Schools Subquery)
        dostupnaPutovanja = db.prepare(`
            SELECT * FROM putovanja 
            WHERE datum >= ? AND naslov LIKE ? AND id NOT IN (
                SELECT putovanje_id FROM prijave WHERE korisnik_id = ?
            )
            ORDER BY ${sort} ASC
        `).all(danas, poljeZaPretragu, req.session.korisnik.id);

        // putovanja na koja je korisnik poslao zahtjev u budućnosti
        mojePrijave = db.prepare(`
            SELECT p.*, pr.status, pr.id AS prijava_id
            FROM putovanja p
            JOIN prijave pr ON p.id = pr.putovanje_id
            WHERE pr.korisnik_id = ? AND p.datum >= ? AND p.naslov LIKE ?
            ORDER BY p.${sort} ASC
        `).all(req.session.korisnik.id, danas, poljeZaPretragu);

    } else if (req.session.korisnik.tip_korisnika === 'agencija') {
        // agencija vidi svoja buduća i status korisnika (koristim LEFT JOIN da prikaze i putovanja bez prijava)
        listaZaAgenciju = db.prepare(`
            SELECT p.*, pr.id as prijava_id, pr.status, k.ime_prezime_ili_naziv as korisnik_ime
            FROM putovanja p
            LEFT JOIN prijave pr ON p.id = pr.putovanje_id
            LEFT JOIN korisnici k ON pr.korisnik_id = k.id
            WHERE p.agencija_id = ? AND p.datum >= ? AND p.naslov LIKE ?
            ORDER BY p.${sort} ASC
        `).all(req.session.korisnik.id, danas, poljeZaPretragu);
    }

    res.render('planirana-putovanja', { 
        dostupnaPutovanja, mojePrijave, listaZaAgenciju, pretraga, sort 
    });
});

// prijavljivanje na putovanje
app.post('/prijavi-se', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');
    const { putovanje_id } = req.body;
    db.prepare("INSERT INTO prijave (korisnik_id, putovanje_id, status) VALUES (?, ?, 'na cekanju')")
      .run(req.session.korisnik.id, putovanje_id);
    res.redirect('/planirana-putovanja');
});

// agencija mijenja status (odobri/odbij)
app.post('/promijeni-status', (req, res) => {
    if (!req.session.korisnik || req.session.korisnik.tip_korisnika !== 'agencija') return res.redirect('/login');
    const { prijava_id, novi_status } = req.body;
    db.prepare("UPDATE prijave SET status = ? WHERE id = ?").run(novi_status, prijava_id);
    res.redirect('/planirana-putovanja');
});

// brisanje putovanja
app.post('/obrisi-putovanje', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');
    const { putovanje_id } = req.body;
    // brisanje prijava prvo, da ne ostanu visak, pa onda putovanje
    db.prepare("DELETE FROM prijave WHERE putovanje_id = ?").run(putovanje_id);
    db.prepare("DELETE FROM putovanja WHERE id = ?").run(putovanje_id);
    
    // Express req.get('referer') vraća prethodnu stranicu pa nas samo refreshuje
    const referer = req.get('referer'); 
    res.redirect(referer || '/moja-putovanja');
});

// ==== PDF GENERISANJE ====
app.get('/putovanje/:id/pdf', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');
    
    const putovanje = db.prepare("SELECT * FROM putovanja WHERE id = ?").get(req.params.id);
    if (!putovanje) return res.status(404).send("Putovanje nije pronađeno");

    // kreiramo PDF
    const doc = new PDFDocument();
    
    // ne downloada bez ovih headera
    res.setHeader('Content-disposition', 'attachment; filename="putovanje_' + putovanje.id + '.pdf"');
    res.setHeader('Content-type', 'application/pdf');

    doc.pipe(res); // Šaljemo PDF direktno u response stream da se zapiše

    doc.fontSize(25).text('Detalji Putovanja', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text(`Naslov: ${putovanje.naslov}`);
    doc.fontSize(14).text(`Datum: ${putovanje.datum}`);
    doc.text(`Prevoz: ${putovanje.prevoz || '/'}`);
    doc.text(`Tip putovanja: ${putovanje.tip_putovanja || '/'}`);
    doc.text(`Cijena: ${putovanje.cijena} KM`);
    doc.moveDown();
    doc.text('Opis:');
    doc.fontSize(12).text(putovanje.opis);

    doc.end(); // Zavrsavamo pisanje u fajl
});

// pravljenje javnog linka
app.post('/podijeli-putovanje/:id', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');

    // token
    const token = crypto.randomBytes(16).toString('hex');
    
    // spasavamo u bazu
    db.prepare("UPDATE putovanja SET share_token = ?, is_public = 1 WHERE id = ?").run(token, req.params.id);
    
    res.redirect('/moja-putovanja');
});

// javna ruta za share (bez provjere prijave)
app.get('/share/:token', (req, res) => {
    const putovanje = db.prepare("SELECT * FROM putovanja WHERE share_token = ? AND is_public = 1").get(req.params.token);
    
    if (!putovanje) {
        return res.status(404).send("<h1>Ovaj link ne postoji ili više nije javan.</h1>");
    }

    res.render('javno-putovanje', { putovanje });
});

// postavke i podaci o studentu
app.get('/postavke', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');
    res.render('postavke');
});

// izmjena samo dozvoljenih polja iz postavki
app.post('/postavke', (req, res) => {
    if (!req.session.korisnik) return res.redirect('/login');
    const { ime_prezime_ili_naziv } = req.body;
    
    db.prepare("UPDATE korisnici SET ime_prezime_ili_naziv = ? WHERE id = ?")
      .run(ime_prezime_ili_naziv, req.session.korisnik.id);
    
    // azuriranje session varijable da se novo ime odmah vidi na stranici
    req.session.korisnik.ime_prezime_ili_naziv = ime_prezime_ili_naziv;
    res.redirect('/postavke');
});

// endpoint za markere GeoJSON
app.get('/api/markeri', (req, res) => {
    if (!req.session.korisnik) return res.json([]);

    try {
        // SQLite ima ugradjene funkcije za datume https://www.sqlitetutorial.net/sqlite-date-functions/sqlite-date-function/
        const upit = `
            SELECT id, naslov, lat, lng 
            FROM putovanja 
            WHERE lat IS NOT NULL 
              AND lng IS NOT NULL 
              AND datum >= date('now', '-30 days') 
              AND datum <= date('now')
        `;
        const putovanja = db.prepare(upit).all();
        
        // formatiramo podatke u GeoJSON format kako je trazeno u specifikaciji
        // uzeo sam format iz https://geojson.org/
        const geojson = {
            type: "FeatureCollection",
            features: putovanja.map(p => ({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [p.lng, p.lat] // longituta latituda (provjeri duplo da se ne zeznem opet)
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