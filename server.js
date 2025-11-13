// Impotando as dependências necessárias
import express from 'express';
import session from 'express-session';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

// Inicialização e configurações do Express e PostgreSQL
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'cantina_db',
    password: 'amods',
    port: 7777,
});

// Testando conexão com o banco de dados
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erro ao conectar ao banco:', err.stack);
    } else {
        console.log('✅ Conectado ao PostgreSQL');
        release();
    }
});

// Configurações de Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'cantina123',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Função para proteger rotas com autenticação
function proteger(req, res, next) {
    if (!req.session.user) return res.redirect('/');
    next();
}

async function runQuery(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
}

// CRIAÇÂO DAS ROTAS

// Rota para login (GET)
app.get("/", (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render("login", { erro: null });
});

// Rota para processar login (POST)
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        // Consulta o banco para verificar se o usuário existe
        const user = await runQuery(
            "SELECT * FROM usuarios WHERE nickname=$1 AND senha=$2",
            [username, password]
        );

        if (user.length === 0) {
            return res.render("login", { erro: "Usuário ou senha incorreta!" });
        }

        req.session.user = user[0];
        res.redirect("/dashboard"); // Usuário logado? Redireciona para o dashboard
    } catch (err) {
        res.render("login", { erro: "Erro ao autenticar!" });
    }
});

// Rota para o logout (GET)
app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// Rota para o dashboard (GET)
app.get("/dashboard", proteger, async (req, res) => {
    try {
        // Obtém os produtos com estoque baixo (menos de 5 unidades)
        const produtosBaixos = await runQuery(
            `SELECT p.*, COALESCE(e.quantidade, 0) as quantidade
             FROM produtos p 
             LEFT JOIN estoque e ON p.id_produto = e.id_produto 
             WHERE COALESCE(e.quantidade, 0) < 5 
             ORDER BY COALESCE(e.quantidade, 0) ASC`
        );

        // Obtém o total de produtos e vendas no sistema
        const totalProdutos = (await runQuery("SELECT COUNT(*) FROM produtos"))[0].count;
        const totalVendas = (await runQuery("SELECT COUNT(*) FROM vendas"))[0].count;

        // Renderiza o dashboard com as informações obtidas
        res.render("dashboard", {
            user: req.session.user,
            produtosBaixos,
            totalProdutos,
            totalMov: totalVendas
        });
    } catch (err) {
        res.status(500).send(`Erro ao carregar dashboard: ${err.message}`);
    }
});

// Rota para cadastrar um novo produto (GET)
app.get("/cadastro-produto", proteger, async (req, res) => {
    try {
        const busca = req.query.busca || '';

        // Consulta os produtos no banco com a possibilidade de filtro por nome
        const produtos = await runQuery(
            busca
                ? `SELECT p.*, COALESCE(e.quantidade, 0) as quantidade
                   FROM produtos p 
                   LEFT JOIN estoque e ON p.id_produto = e.id_produto 
                   WHERE p.nome ILIKE $1 
                   ORDER BY p.nome ASC`
                : `SELECT p.*, COALESCE(e.quantidade, 0) as quantidade
                   FROM produtos p 
                   LEFT JOIN estoque e ON p.id_produto = e.id_produto 
                   ORDER BY p.nome ASC`,
            busca ? [`%${busca}%`] : []
        );

        // Renderiza a página de cadastro de produtos
        res.render("cadastro-produto", {
            user: req.session.user,
            produtos,
            busca
        });
    } catch (err) {
        res.status(500).send(`Erro ao carregar produtos: ${err.message}`);
    }
});

// Rota para cadastrar um produto (POST)
app.post("/cadastro-produto", proteger, async (req, res) => {
    const { nome, quantidade, preco } = req.body;

    // Verifica se todos os campos obrigatórios
    if (!nome || !quantidade || !preco) {
        return res.status(400).send("Preencha todos os campos!");
    }

    // Insere o produto na tabela de produtos
    try {
        const produto = await runQuery(
            "INSERT INTO produtos (nome, preco) VALUES ($1, $2) RETURNING id_produto",
            [nome, preco]
        );

        // Insere o estoque correspondente ao produto
        await runQuery(
            "INSERT INTO estoque (id_produto, quantidade) VALUES ($1, $2)",
            [produto[0].id_produto, quantidade]
        );

        res.redirect("/cadastro-produto");
    } catch (err) {
        res.status(500).send(`Erro ao cadastrar: ${err.message}`);
    }
});

// Rota para atualizar um produto (POST)
app.post("/cadastro-produto/update/:id", proteger, async (req, res) => {
    const { id } = req.params;
    const { nome, quantidade, preco } = req.body;

    try {
        // Atualiza as informações do produto
        await runQuery(
            "UPDATE produtos SET nome=$1, preco=$2 WHERE id_produto=$3",
            [nome, preco, id]
        );

        // Verifica se já existe um estoque e se existe, atualiza; se não, insere
        const estoqueExiste = await runQuery(
            "SELECT * FROM estoque WHERE id_produto=$1",
            [id]
        );

        if (estoqueExiste.length > 0) {
            await runQuery(
                "UPDATE estoque SET quantidade=$1 WHERE id_produto=$2",
                [quantidade, id]
            );
        } else {
            await runQuery(
                "INSERT INTO estoque (id_produto, quantidade) VALUES ($1, $2)",
                [id, quantidade]
            );
        }

        res.redirect("/cadastro-produto");
    } catch (err) {
        res.status(500).send(`Erro ao atualizar: ${err.message}`);
    }
});

// Rota para excluir um produto (POST)
app.post("/cadastro-produto/delete/:id", proteger, async (req, res) => {
    const { id } = req.params;

    try {
        // Verifica se o produto já foi vendido (não pode ser excluído se houver vendas)
        const vendas = await runQuery(
            "SELECT COUNT(*) FROM vendas WHERE id_produto=$1",
            [id]
        );

        // Se o produto tiver registros de venda, impede a exclusão
        if (parseInt(vendas[0].count) > 0) {
            return res.status(400).send("Não é possível excluir! Existem vendas registradas.");
        }

        // Remove o produto do estoque
        await runQuery("DELETE FROM estoque WHERE id_produto=$1", [id]);
        // Remove o produto da tabela de produtos
        await runQuery("DELETE FROM produtos WHERE id_produto=$1", [id]);

        res.redirect("/cadastro-produto");
    } catch (err) {
        res.status(500).send(`Erro ao deletar: ${err.message}`);
    }
});

// Rota para exibir as vendas realizadas (GET)
app.get("/movimentacoes", proteger, async (req, res) => {
    try {
        const produtos = await runQuery(
            "SELECT * FROM produtos ORDER BY nome"
        );

        // Busca todas as vendas, juntando informações do produto e do usuário
        const vendas = await runQuery(
            `SELECT v.id_venda, v.id_produto, v.quantidade, v.preco_total, v.data_venda, p.nome, u.nickname 
             FROM vendas v 
             JOIN produtos p ON v.id_produto = p.id_produto 
             JOIN usuarios u ON v.id_usuario = u.id_usuario 
             ORDER BY v.data_venda DESC`
        );

        // Renderiza a página "movimentacoes.ejs" com os dados de vendas e produtos
        res.render("movimentacoes", {
            user: req.session.user,
            produtos,
            movimentos: vendas
        });
    } catch (err) {
        res.status(500).send(`Erro ao carregar vendas: ${err.message}`);
    }
});


// Rota para registrar uma nova venda (POST)
app.post("/movimentacoes", proteger, async (req, res) => {
    const { produto_id, quantidade } = req.body;
    const user_id = req.session.user.id_usuario;

    try {
        const estoque = await runQuery(
            "SELECT quantidade FROM estoque WHERE id_produto=$1",
            [produto_id]
        );

        // Verifica se o produto existe no estoque
        if (estoque.length === 0) {
            return res.status(400).send("Produto não encontrado no estoque!");
        }

        // Verifica se há estoque suficiente para a venda
        if (estoque[0].quantidade < parseInt(quantidade)) {
            return res.status(400).send(`Estoque insuficiente! Disponível: ${estoque[0].quantidade}`);
        }

        // Busca o preço atual do produto
        const produto = await runQuery(
            "SELECT preco FROM produtos WHERE id_produto=$1",
            [produto_id]
        );

        // Calcula o preço total da venda
        const preco_total = produto[0].preco * quantidade;

        // Registra a venda na tabela "vendas"
        await runQuery(
            'INSERT INTO vendas (id_usuario, id_produto, quantidade, preco_total) VALUES ($1, $2, $3, $4)',
            [user_id, produto_id, quantidade, preco_total]
        );

        // Atualiza o estoque subtraindo a quantidade vendida
        await runQuery(
            "UPDATE estoque SET quantidade = quantidade - $1 WHERE id_produto = $2",
            [quantidade, produto_id]
        );

        res.redirect("/movimentacoes");
    } catch (err) {
        res.status(500).send(`Erro ao registrar venda: ${err.message}`);
    }
});

// Rota para tratar páginas não encontradas (404)
app.use((req, res) => {
    res.status(404).send('Página não encontrada');
});

// Inicialização do servidor
const PORT = 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando em http://localhost:${PORT}`));