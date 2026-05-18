const Database = require('better-sqlite3');
const putanjaDoBaze = './baza_putovanja.db';

// template uzet iz https://github.com/WiseLibs/better-sqlite3
const db = new Database(putanjaDoBaze, { verbose: console.log }); // verbose ispisuje SQL upite u terminal da vidim šta se dešava

// inicijalizacija tabela - ovo sam našao na StackOverflow kako pokrenuti više upita odjednom
// https://stackoverflow.com/questions/51522336/how-to-run-multiple-sql-queries-in-better-sqlite3
const kreirajTabele = `
    -- Tabela za korisnike i agencije
    CREATE TABLE IF NOT EXISTS korisnici (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tip_korisnika TEXT CHECK(tip_korisnika IN ('osoba', 'agencija')) NOT NULL,
        ime_prezime_ili_naziv TEXT NOT NULL,
        korisnicko_ime TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        lozinka TEXT NOT NULL,
        datum_osnivanja TEXT -- Ovo je samo za agencije
    );

    -- Tabela za putovanja
    CREATE TABLE IF NOT EXISTS putovanja (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        naslov TEXT NOT NULL,
        opis TEXT,
        datum TEXT NOT NULL,
        tip_putovanja TEXT, -- npr. samostalno, organizovano
        prevoz TEXT,
        cijena REAL,
        lat REAL, -- Koordinate sa mape (Leaflet)
        lng REAL,
        agencija_id INTEGER,
        is_public INTEGER DEFAULT 0, -- 1 znači da je javno za dijeljenje
        share_token TEXT, -- Token za javni link (iz speckice)
        FOREIGN KEY(agencija_id) REFERENCES korisnici(id)
    );

    -- Tabela za prijave na putovanja
    CREATE TABLE IF NOT EXISTS prijave (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        korisnik_id INTEGER NOT NULL,
        putovanje_id INTEGER NOT NULL,
        status TEXT DEFAULT 'na cekanju', -- 'na cekanju', 'odobreno', 'odbijeno'
        FOREIGN KEY(korisnik_id) REFERENCES korisnici(id),
        FOREIGN KEY(putovanje_id) REFERENCES putovanja(id)
    );
`;

// query da se tabele naprave ako ne postoje
db.exec(kreirajTabele);

console.log('Baza podataka je uspješno inicijalizirana.');

module.exports = db;