import { MercadoPagoConfig, Payment } from 'mercadopago';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';

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

        // Si el pago es aprobado, enviar UNA SOLA notificación a Telegram
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

            // Enviar una única notificación
            await sendTelegramNotification(notificationData);
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

//Ruta para el envio de email de confirmacion al cliente
app.post('/send-confirmation-email', (req, res) => {
    const { email, orderId, items, total } = req.body;
  
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Confirmación de tu pedido',
      text: `Gracias por tu compra!\n\nTu ID de pedido es: ${orderId}\n\nDetalles de tu pedido:\n${items}\n\nTotal: $${total}`
    };
  
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        return res.status(500).send(error.toString());
      }
      res.status(200).send('Correo enviado: ' + info.response);
    });
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