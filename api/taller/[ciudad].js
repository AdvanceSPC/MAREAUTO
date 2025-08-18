import mysql from 'mysql2/promise';

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
        rejectUnauthorized: false
    }
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { ciudad } = req.query;
    const { marca, multimarca = 'false' } = req.query;

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        let query = 'SELECT * FROM TALLERES WHERE NOMBRE_CIUDAD = ? AND ESTADO = ?';
        let params = [ciudad.toUpperCase(), 'A'];

        if (marca) {
            if (multimarca === 'true') {
                query += ' AND (MARCA LIKE ? OR MULTIMARCA = ?)';
                params.push(`%${marca}%`, 'SI');
            } else {
                query += ' AND MARCA LIKE ?';
                params.push(`%${marca}%`);
            }
        }

        query += ' ORDER BY NRO_MAX_CITAS DESC';

        const [talleres] = await connection.execute(query, params);

        return res.status(200).json({
            success: true,
            data: {
                ciudad: ciudad.toUpperCase(),
                totalTalleres: talleres.length,
                talleres: talleres.map(taller => ({
                    id: taller.TALLER,
                    nombre: taller.NOMBRE,
                    direccion: taller.DIRECCION,
                    ciudad: taller.NOMBRE_CIUDAD,
                    telefono: taller.TELEFONO,
                    maxCitas: taller.NRO_MAX_CITAS,
                    esConcesionario: taller.CONCESIONARIO === 'SI',
                    esMultimarca: taller.MULTIMARCA === 'SI',
                    marcasAtendidas: taller.MARCA,
                    disponible: taller.ESTADO === 'A'
                }))
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}