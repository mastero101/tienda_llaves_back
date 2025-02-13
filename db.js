import { Sequelize, DataTypes } from 'sequelize';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Configuración de Sequelize
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectModule: pg,
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: false,
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

// Definición del modelo Purchase
const Purchase = sequelize.define('Purchase', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    payment_id: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    net_amount: {
        type: DataTypes.DECIMAL(10, 2)
    },
    customer_email: {
        type: DataTypes.STRING,
        allowNull: false
    },
    payment_method: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    payment_status: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT
    },
    purchase_date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    card_type: {
        type: DataTypes.STRING(50)
    },
    installments: {
        type: DataTypes.INTEGER
    },
    card_last_digits: {
        type: DataTypes.STRING(4)
    }
}, {
    freezeTableName: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
});

// Definición del modelo PurchaseItem
const PurchaseItem = sequelize.define('PurchaseItem', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    product_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    }
}, {
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
});

// Establecer relaciones
Purchase.hasMany(PurchaseItem, {
    foreignKey: 'purchase_id',
    onDelete: 'CASCADE'
});
PurchaseItem.belongsTo(Purchase, {
    foreignKey: 'purchase_id'
});

// Función para inicializar la base de datos
async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        console.log('Conexión a la base de datos establecida correctamente.');
        
        // Sincronizar los modelos con la base de datos
        await sequelize.sync({ alter: true });
        console.log('Modelos sincronizados correctamente.');
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
        throw error;
    }
}

// Función para guardar pago con tarjeta
async function saveCardPayment(paymentData) {
    const t = await sequelize.transaction();
    
    try {
        // Crear el registro de compra
        const purchase = await Purchase.create({
            payment_id: paymentData.paymentId,
            amount: paymentData.amount,
            net_amount: paymentData.netAmount,
            customer_email: paymentData.customerEmail,
            payment_method: paymentData.paymentMethod,
            payment_status: paymentData.status,
            description: paymentData.description,
            purchase_date: paymentData.date,
            card_type: paymentData.cardType,
            installments: paymentData.installments,
            card_last_digits: paymentData.cardLastDigits
        }, { transaction: t });

        // Crear los items de la compra
        if (paymentData.items && paymentData.items.length > 0) {
            const purchaseItems = paymentData.items.map(item => ({
                purchase_id: purchase.id,
                product_name: item.product.name,
                quantity: item.quantity,
                price: item.product.price
            }));

            await PurchaseItem.bulkCreate(purchaseItems, { transaction: t });
        }

        await t.commit();
        return purchase.id;
    } catch (error) {
        await t.rollback();
        throw error;
    }
}

// Función para guardar transferencia bancaria
async function saveBankTransfer(transferData) {
    const t = await sequelize.transaction();
    
    try {
        // Crear el registro de transferencia
        const purchase = await Purchase.create({
            payment_id: transferData.paymentId,
            amount: transferData.amount,
            customer_email: transferData.customerEmail,
            payment_method: 'transfer',
            payment_status: 'pending',
            description: 'Transferencia bancaria',
            purchase_date: transferData.date
        }, { transaction: t });

        // Crear los items de la transferencia
        if (transferData.items && transferData.items.length > 0) {
            const purchaseItems = transferData.items.map(item => ({
                purchase_id: purchase.id,
                product_name: item.product.name,
                quantity: item.quantity,
                price: item.product.price
            }));

            await PurchaseItem.bulkCreate(purchaseItems, { transaction: t });
        }

        await t.commit();
        return purchase.id;
    } catch (error) {
        await t.rollback();
        throw error;
    }
}

export {
    sequelize,
    Purchase,
    PurchaseItem,
    initializeDatabase,
    saveCardPayment,
    saveBankTransfer
};