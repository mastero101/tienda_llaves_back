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

// Función para formatear la fecha
function formatDate(date) {
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    return new Date(date).toLocaleDateString('es-ES', options);
}

// Función para enviar notificación por Telegram
async function sendTelegramNotification(paymentData) {
    try {
        if (!paymentData) {
            console.log('No se recibieron datos de pago');
            throw new Error('No se recibieron datos de pago');
        }

        console.log('Datos recibidos en notificación:', paymentData);

        // Formatear los artículos como una lista
        const itemsList = paymentData.items.map(item => 
            `${item.quantity}x ${item.product.name} - $${item.product.price}`
        ).join('\n');

        let message;
        if (paymentData.paymentMethod === 'transfer') {
            // Mensaje para transferencias bancarias
            message = 
                `🎉 ¡Nueva Transferencia Bancaria!\n\n` +
                `💰 Monto: $${paymentData.amount}\n` +
                `🔢 ID de Transferencia: ${paymentData.paymentId}\n` +
                `📧 Cliente: ${paymentData.customerEmail || 'No especificado'}\n` +
                `📝 Descripción: ${paymentData.description || 'N/A'}\n` +
                `📅 Fecha: ${formatDate(paymentData.date)}\n\n` +
                `🛒 Artículos Comprados:\n${itemsList}\n\n` +
                `🔍 Detalles adicionales:\n` +
                `- Método: ${paymentData.paymentMethod}`;
        } else {
            // Mensaje para pagos con tarjeta
            message = 
                `🎉 ¡Nueva Venta Realizada!\n\n` +
                `💰 Monto: $${paymentData.amount}\n` +
                `💵 Monto Neto: $${paymentData.netAmount || 'N/A'}\n` +
                `🔢 ID de Pago: ${paymentData.paymentId}\n` +
                `✅ Estado: ${paymentData.status}\n` +
                `💳 Método: ${paymentData.paymentMethod} (${paymentData.cardType || 'N/A'})\n` +
                `📧 Cliente: ${paymentData.customerEmail || 'No especificado'}\n` +
                `📝 Descripción: ${paymentData.description || 'N/A'}\n` +
                `📅 Fecha: ${formatDate(paymentData.date)}\n\n` +
                `🛒 Artículos Comprados:\n${itemsList}\n\n` +
                `🔍 Detalles adicionales:\n` +
                `- Cuotas: ${paymentData.installments}\n` +
                `- Últimos 4 dígitos: ${paymentData.cardLastDigits}`;
        }

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
                description: payment.description,
                items: req.body.items || [] // Asegúrate de incluir los items aquí
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
        // Plantilla HTML mejorada
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Confirmación de Pago</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f4f4f4;
                        margin: 0;
                        padding: 0;
                    }
                    .container {
                        max-width: 600px;
                        margin: 20px auto;
                        background-color: #ffffff;
                        padding: 20px;
                        border-radius: 8px;
                        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    }
                    .header {
                        text-align: center;
                        padding-bottom: 20px;
                        border-bottom: 1px solid #ddd;
                    }
                    .header img {
                        max-width: 150px;
                    }
                    .content {
                        margin-top: 20px;
                    }
                    .content h1 {
                        color: #333;
                        font-size: 24px;
                    }
                    .content p {
                        color: #555;
                        font-size: 16px;
                        line-height: 1.6;
                    }
                    .footer {
                        margin-top: 20px;
                        text-align: center;
                        font-size: 14px;
                        color: #888;
                    }
                    .footer a {
                        color: #007BFF;
                        text-decoration: none;
                    }
                    .footer a:hover {
                        text-decoration: underline;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <img src="https://ejemplo.com/logo.png" alt="Logo de la empresa">
                        <h1>¡Gracias por tu compra!</h1>
                    </div>
                    <div class="content">
                        <p>Hola ${paymentData.payer?.first_name || 'Cliente'},</p>
                        <p>Tu pago ha sido procesado exitosamente. Aquí están los detalles de tu transacción:</p>
                        <ul>
                            <li><strong>ID de Pago:</strong> ${paymentData.id}</li>
                            <li><strong>Monto:</strong> $${paymentData.transaction_amount}</li>
                            <li><strong>Estado:</strong> ${paymentData.status}</li>
                            <li><strong>Método de Pago:</strong> ${paymentData.payment_method_id} (${paymentData.payment_type_id || 'N/A'})</li>
                            <li><strong>Cuotas:</strong> ${paymentData.installments}</li>
                            <li><strong>Descripción:</strong> ${paymentData.description}</li>
                        </ul>
                        <p>Si tienes alguna pregunta o necesitas asistencia, no dudes en contactarnos en <a href="mailto:castro.alejandro17@gmail.com">castro.alejandro17@gmail.com</a> o 529811402316.</p>
                    </div>
                    <div class="footer">
                        <p>Gracias por confiar en nosotros.</p>
                        <p><a href="https://tienda-llaves-front.vercel.app/">Visita nuestra tienda</a></p>
                    </div>
                </div>
            </body>
            </html>
        `;

        // Configurar el mensaje
        const msg = {
            to: customerEmail,
            from: 'castro.alejandro17@gmail.com', // Cambia esto por tu correo verificado
            subject: 'Confirmación de Pago',
            text: `Gracias por tu pago!\n\nDetalles del pago:\nID de Pago: ${paymentData.id}\nMonto: $${paymentData.transaction_amount}\nEstado: ${paymentData.status}\nDescripción: ${paymentData.description}`,
            html: htmlContent,
        };

        // Enviar el correo
        await sgMail.send(msg);
        console.log(`Correo de confirmación enviado a: ${customerEmail}`);
        return true;
    } catch (error) {
        console.error('Error al enviar el correo de confirmación:', error);
        return false;
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

// Función para enviar correo de confirmación de transferencia bancaria
async function sendBankTransferConfirmationEmail(customerEmail, transferDetails) {
    try {
      // Formatear los artículos como una lista
      const itemsList = transferDetails.items.map(item => 
        `${item.quantity}x ${item.product.name} - $${item.product.price}`
      ).join('<br>');
  
      const msg = {
        to: customerEmail,
        from: 'castro.alejandro17@gmail.com', // Cambia esto por tu correo
        subject: 'Confirmación de Transferencia Bancaria',
        html: `
          <h1>Confirmación de Transferencia Bancaria</h1>
          <p>Gracias por tu compra. Por favor, realiza la transferencia con los siguientes detalles:</p>
          <h2>Datos Bancarios</h2>
          <p>Banco: ${transferDetails.bankInfo.name}</p>
          <p>Beneficiario: ${transferDetails.bankInfo.accountHolder}</p>
          <p>CLABE: ${transferDetails.bankInfo.clabe}</p>
          <p>Monto a Transferir: $${transferDetails.amount}</p>
          <p>ID de Transferencia: ${transferDetails.paymentId}</p>
          <h2>Artículos Comprados</h2>
          <p>${itemsList}</p>
          <p>Una vez realizada la transferencia, nuestro equipo procesará tu pedido.</p>
        `
      };
  
      await sgMail.send(msg);
      console.log(`Correo de confirmación de transferencia enviado a: ${customerEmail}`);
      return true;
    } catch (error) {
      console.error('Error al enviar el correo de confirmación de transferencia:', error);
      return false;
    }
  }
  
  app.post('/bank-transfer-confirmation', async (req, res) => {
    try {
      console.log('Datos recibidos en el backend:', req.body); // Agregar log para depuración
  
      const { customerEmail, transferDetails } = req.body;
  
      // Extraer items de transferDetails
      const items = transferDetails.items;
  
      // Verificar que los datos estén presentes
      if (!customerEmail || !transferDetails || !items) {
        throw new Error('Datos incompletos en la solicitud');
      }
  
      // Generar un ID de transferencia único
      const paymentId = `TRANSFER-${Date.now()}`;
  
      // Enviar correo de confirmación
      const emailSent = await sendBankTransferConfirmationEmail(customerEmail, {
        ...transferDetails,
        paymentId: paymentId, // Incluir el ID de la transferencia
        items: items // Incluir los artículos del carrito
      });
  
      if (emailSent) {
        // Formatear los datos para la notificación de Telegram
        const notificationData = {
          paymentId: paymentId, // Usar el mismo ID generado anteriormente
          amount: transferDetails.amount,
          customerEmail: customerEmail,
          status: 'pending', // Estado de la transferencia
          paymentMethod: 'transfer', // Método de pago
          description: 'Transferencia bancaria',
          date: new Date(), // Pasar la fecha como un objeto Date
          items: items // Incluir los artículos del carrito
        };
  
        // Enviar notificación a Telegram
        const telegramSent = await sendTelegramNotification(notificationData);
  
        if (!telegramSent) {
          console.error('Error al enviar notificación de Telegram');
        }
  
        res.status(200).json({ 
          message: 'Correo de confirmación de transferencia enviado',
          status: 'success',
          paymentId: paymentId // Devolver el ID de transferencia en la respuesta
        });
      } else {
        res.status(500).json({ 
          message: 'Error al enviar correo de confirmación',
          status: 'error'
        });
      }
    } catch (error) {
      console.error('Error en ruta de confirmación de transferencia:', error);
      res.status(500).json({ 
        message: 'Error interno del servidor',
        status: 'error',
        details: error.message
      });
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