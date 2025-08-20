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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { placa } = req.query;

    if (!placa) {
        return res.status(400).json({
            error: 'La placa es requerida',
            message: 'Debe proporcionar una placa válida como parámetro'
        });
    }

    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);

        const [vehiculos] = await connection.execute(
            'SELECT * FROM MAREAUTO WHERE PLACA = ?',
            [placa.toUpperCase()]
        );

        if (vehiculos.length === 0) {
            return res.status(404).json({
                error: 'Vehículo no encontrado',
                message: `No se encontró un vehículo con la placa ${placa}`
            });
        }

        const vehiculo = vehiculos[0];

        let ciudadVehiculo = vehiculo.CIUDAD_ULTIMO_MTTO || 'QUITO';
        let paisVehiculo = 'ECUADOR';

        if (vehiculo.ULTIMO_TALLER_MTTO && vehiculo.ULTIMO_TALLER_MTTO.includes('PERU')) {
            paisVehiculo = 'PERU';
        }

        const [talleresCiudad] = await connection.execute(
            'SELECT * FROM TALLERES WHERE NOMBRE_CIUDAD = ? AND ESTADO = ? ORDER BY NRO_MAX_CITAS DESC',
            [ciudadVehiculo, 'A']
        );

        let talleresPais = [];
        if (talleresCiudad.length === 0) {
            const [talleresPaisResult] = await connection.execute(
                'SELECT * FROM TALLERES WHERE PAIS = ? AND ESTADO = ? ORDER BY NRO_MAX_CITAS DESC',
                [paisVehiculo, 'A']
            );
            talleresPais = talleresPaisResult;
        }

        const kmRecorridos = vehiculo.KM_REAL_GPS - vehiculo.ULTIMO_KM_MTTO;
        const proximoMantenimiento = vehiculo.ULTIMO_KM_MTTO + vehiculo.PLAN_DE_MTTO;
        const kmFaltantes = Math.max(0, proximoMantenimiento - vehiculo.KM_REAL_GPS);
        const necesitaMantenimiento = kmRecorridos >= vehiculo.PLAN_DE_MTTO;

        const respuesta = {
            vehiculo: {
                placa: vehiculo.PLACA,
                marca: vehiculo.MARCA,
                modelo: vehiculo.MODELO,
                kmActual: vehiculo.KM_REAL_GPS,
                ultimoKmMantenimiento: vehiculo.ULTIMO_KM_MTTO,
                planMantenimiento: vehiculo.PLAN_DE_MTTO,
                ultimoTaller: vehiculo.ULTIMO_TALLER_MTTO,
                ciudadUltimoMantenimiento: vehiculo.CIUDAD_ULTIMO_MTTO,
                estadoGarantia: vehiculo.ESTADO_GARANTIA,
                analisisMantenimiento: {
                    kmRecorridosDesdeUltimoMtto: kmRecorridos,
                    proximoMantenimientoEn: proximoMantenimiento,
                    kmFaltantesParaMtto: kmFaltantes,
                    necesitaMantenimiento: necesitaMantenimiento
                }
            },
            talleres: {
                ciudad: ciudadVehiculo,
                pais: paisVehiculo,
                talleresEnCiudad: talleresCiudad.map(taller => ({
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
                })),
                talleresPais: talleresPais.length > 0 ? talleresPais.slice(0, 10).map(taller => ({
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
                })) : []
            },
            recomendaciones: {
                tallerRecomendado: null,
                razonRecomendacion: '',
                talleresPorMarca: [],
                talleresCercanos: []
            }
        };

        const [talleresMarca] = await connection.execute(
            `SELECT * FROM TALLERES 
            WHERE (MARCA LIKE ? OR MARCA = 'TODAS' OR MULTIMARCA = 'SI') 
            AND ESTADO = ? AND PAIS = ?
            ORDER BY 
            CASE 
                WHEN MARCA LIKE ? THEN 1
                WHEN CONCESIONARIO = 'SI' THEN 2
                WHEN MULTIMARCA = 'SI' THEN 3
                ELSE 4
            END,    
            CASE WHEN NOMBRE_CIUDAD = ? THEN 1 ELSE 2 END,
            NRO_MAX_CITAS DESC`,
            [`%${vehiculo.MARCA}%`, 'A', paisVehiculo, `%${vehiculo.MARCA}%`, ciudadVehiculo]
        );

        respuesta.recomendaciones.talleresPorMarca = talleresMarca.slice(0, 5).map(taller => ({
            id: taller.TALLER,
            nombre: taller.NOMBRE,
            direccion: taller.DIRECCION,
            ciudad: taller.NOMBRE_CIUDAD,
            telefono: taller.TELEFONO,
            maxCitas: taller.NRO_MAX_CITAS,
            esConcesionario: taller.CONCESIONARIO === 'SI',
            esMultimarca: taller.MULTIMARCA === 'SI',
            marcasAtendidas: taller.MARCA,
            disponible: taller.ESTADO === 'A',
            enMismaCiudad: taller.NOMBRE_CIUDAD === ciudadVehiculo
        }));

        if (talleresMarca.length > 0) {
            const tallerRecomendado = talleresMarca[0];
            respuesta.recomendaciones.tallerRecomendado = {
                id: tallerRecomendado.TALLER,
                nombre: tallerRecomendado.NOMBRE,
                direccion: tallerRecomendado.DIRECCION,
                ciudad: tallerRecomendado.NOMBRE_CIUDAD,
                telefono: tallerRecomendado.TELEFONO,
                maxCitas: tallerRecomendado.NRO_MAX_CITAS,
                esConcesionario: tallerRecomendado.CONCESIONARIO === 'SI',
                esMultimarca: tallerRecomendado.MULTIMARCA === 'SI',
                marcasAtendidas: tallerRecomendado.MARCA
            };

            if (tallerRecomendado.MARCA === vehiculo.MARCA) {
                respuesta.recomendaciones.razonRecomendacion = `Taller especializado en ${vehiculo.MARCA}`;
            } else if (tallerRecomendado.CONCESIONARIO === 'SI') {
                respuesta.recomendaciones.razonRecomendacion = 'Concesionario oficial con alta capacidad';
            } else {
                respuesta.recomendaciones.razonRecomendacion = 'Taller multimarca con buena capacidad';
            }
        }

        return res.status(200).json({
            success: true,
            data: respuesta,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error en la consulta:', error);
        return res.status(500).json({
            error: 'Error interno del servidor',
            message: 'Error al consultar la base de datos',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}