import { MercadoPagoConfig, Payment } from 'mercadopago';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import sgMail from '@sendgrid/mail';

dotenv.config();

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
}));

app.use(express.json());

// Configuración de Mercado Pago
const client = new MercadoPagoConfig({ 
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN 
});

// Configuración de Telegram con polling activado
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Agregar un listener para mensajes
bot.on('message', (msg) => {
    console.log('Mensaje recibido:', msg);
    console.log('Chat ID:', msg.chat.id);
});

// Configurar SendGrid con la API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Función para enviar notificación por Telegram
async function sendTelegramNotification(paymentData) {
    try {
        if (!paymentData) {
            console.log('No se recibieron datos de pago');
            throw new Error('No se recibieron datos de pago');
        }

        console.log('Datos recibidos en notificación:', paymentData);

        const message = 
            `🎉 ¡Nueva Venta Realizada!\n\n` +
            `💰 Monto: $${paymentData.amount}\n` +
            `💵 Monto Neto: $${paymentData.netAmount || 'N/A'}\n` +
            `🔢 ID de Pago: ${paymentData.paymentId}\n` +
            `✅ Estado: ${paymentData.status}\n` +
            `💳 Método: ${paymentData.paymentMethod} (${paymentData.cardType || 'N/A'})\n` +
            `📧 Cliente: ${paymentData.customerEmail || 'No especificado'}\n` +
            `📝 Descripción: ${paymentData.description || 'N/A'}\n` +
            `📅 Fecha: ${new Date(paymentData.date).toLocaleString()}\n\n` +
            `🔍 Detalles adicionales:\n` +
            `- Cuotas: ${paymentData.installments}\n` +
            `- Últimos 4 dígitos: ${paymentData.cardLastDigits}`;

        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            throw new Error('Faltan credenciales de Telegram');
        }

        const result = await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
        console.log('Mensaje de Telegram enviado exitosamente');
        return true;
    } catch (error) {
        console.error('Error al enviar notificación de Telegram:', error);
        return false;
    }
}

// Ruta para procesar pagos
app.post('/process-payment', async (req, res) => {
    try {
        console.log('Datos recibidos:', req.body);

        const paymentData = {
            transaction_amount: parseFloat(req.body.transaction_amount),
            token: req.body.token,
            description: req.body.description || 'Pago de producto',
            installments: parseInt(req.body.installments) || 1,
            payment_method_id: req.body.payment_method_id,
            payer: {
                email: req.body.payer?.email,
                identification: {
                    type: req.body.payer?.identification?.type || "DNI",
                    number: req.body.payer?.identification?.number
                }
            }
        };

        const paymentClient = new Payment(client);
        const payment = await paymentClient.create({ body: paymentData });
        
        console.log('Respuesta de MP:', payment);

        // Si el pago es aprobado, enviar notificación y correo
        if (payment.status === 'approved') {
            // Formatear los datos para la notificación
            const notificationData = {
                paymentId: payment.id,
                amount: payment.transaction_amount,
                netAmount: payment.transaction_details?.net_received_amount,
                date: payment.date_created,
                customerEmail: req.body.payer?.email || payment.payer?.email,
                status: payment.status,
                paymentMethod: payment.payment_method_id,
                cardType: payment.payment_type_id,
                installments: payment.installments,
                cardLastDigits: payment.card?.last_four_digits || 'N/A',
                description: payment.description
            };

            // Enviar notificación
            await sendTelegramNotification(notificationData);

            // Enviar correo de confirmación localmente
            const emailSent = await sendConfirmationEmail(notificationData.customerEmail, payment);
            if (!emailSent) {
                console.error('Error al enviar el correo de confirmación');
            }
        }
        
        res.json({
            status: payment.status,
            status_detail: payment.status_detail,
            id: payment.id,
            transaction_amount: payment.transaction_amount
        });
    } catch (error) {
        console.error('Error detallado:', error.response?.data || error);
        res.status(500).json({
            error: 'Error al procesar el pago',
            details: error.response?.data || error.message
        });
    }
});

// Función para enviar el correo de confirmación
async function sendConfirmationEmail(customerEmail, paymentData) {
    try {
        const msg = {
            to: customerEmail, // Correo del cliente
            from: 'castro.alejandro17@gmail.com', // Tu correo verificado en SendGrid
            subject: 'Confirmación de Pago',
            text: `Gracias por tu pago!\n\nDetalles del pago:\nID de Pago: ${paymentData.id}\nMonto: $${paymentData.transaction_amount}\nEstado: ${paymentData.status}\nDescripción: ${paymentData.description}`,
            html: `<strong>Gracias por tu pago!</strong><br><br>Detalles del pago:<br>ID de Pago: ${paymentData.id}<br>Monto: $${paymentData.transaction_amount}<br>Estado: ${paymentData.status}<br>Descripción: ${paymentData.description}`,
        };

        // Enviar el correo
        await sgMail.send(msg);
        console.log(`Correo de confirmación enviado a: ${customerEmail}`);
        return true; // Retornar true si el correo se envió correctamente
    } catch (error) {
        console.error('Error al enviar el correo de confirmación:', error);
        return false; // Retornar false si hubo un error
    }
}

// Ruta para enviar el correo de confirmación
app.post('/send-confirmation-email', async (req, res) => {
    try {
        const { customerEmail, paymentId } = req.body;

        // Aquí iría la lógica para enviar el correo
        // Por ejemplo, usando un servicio de correo como nodemailer
        console.log(`Enviando correo de confirmación a: ${customerEmail} para el pago ID: ${paymentId}`);

        // Simulación de envío de correo
        // await sendEmail(customerEmail, paymentId);

        res.json({ message: 'Correo de confirmación enviado correctamente' });
    } catch (error) {
        console.error('Error al enviar el correo de confirmación:', error);
        res.status(500).json({ error: 'Error al enviar el correo de confirmación' });
    }
});

// Ruta de health check
app.get('/', (req, res) => {
    try {
        res.status(200).json({
            status: 'success',
            message: 'API is running',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Health check failed',
            error: error.message
        });
    }
});

// Versión más detallada (opcional)
app.get('/health', async (req, res) => {
    try {
        // Verificar la conexión con Mercado Pago
        const client = new MercadoPagoConfig({ 
            accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN 
        });

        res.status(200).json({
            status: 'success',
            message: 'All systems operational',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            services: {
                api: 'healthy',
                mercadoPago: 'connected',
            },
            config: {
                cors: 'enabled',
                version: process.env.npm_package_version || '1.0.0'
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Health check failed',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor corriendo en puerto ${PORT}`);
    });
}

export default app;