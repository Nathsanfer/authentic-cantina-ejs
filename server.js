import express from 'express';
import session from 'express-session';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'cantina_db',
    password: 'amods',
    port: 7777,
});

// Testar conexão
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erro ao conectar ao banco:', err.stack);
    } else {
        console.log('✅ Conectado ao PostgreSQL');
        release();
    }
});

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

function proteger(req, res, next) {
    if (!req.session.user) {
        console.log('❌ Usuário não autenticado, redirecionando para login');
        return res.redirect('/');
    }
    console.log('✅ Usuário autenticado:', req.session.user.nickname);
    next();
}

async function runQuery(sql, params = []) {
    try {
        console.log('🔍 Executando query:', sql.substring(0, 50) + '...');
        const result = await pool.query(sql, params);
        console.log('✅ Query executada com sucesso. Linhas retornadas:', result.rows.length);
        return result.rows;
    } catch (error) {
        console.error('❌ Erro na query:', error.message);
        console.error('SQL:', sql);
        console.error('Params:', params);
        throw error;
    }
}

// ROTAS
app.get("/", (req, res) => {
    console.log('📍 Rota: GET /');
    if (req.session.user) {
        console.log('Usuário já logado, redirecionando para dashboard');
        return res.redirect('/dashboard');
    }
    res.render("login", { erro: null });
});

app.post("/login", async (req, res) => {
    console.log('📍 Rota: POST /login');
    const { username, password } = req.body;
    console.log('Tentativa de login:', username);

    try {
        const user = await runQuery(
            "SELECT * FROM usuarios WHERE nickname=$1 AND senha=$2",
            [username, password]
        );

        if (user.length === 0) {
            console.log('❌ Login falhou: credenciais inválidas');
            return res.render("login", { erro: "Usuário ou senha incorreta!" });
        }

        req.session.user = user[0];
        console.log('✅ Login bem-sucedido:', user[0].nickname);
        res.redirect("/dashboard");
    } catch (err) {
        console.error('❌ Erro no login:', err);
        res.render("login", { erro: "Erro ao autenticar!" });
    }
});

app.get("/logout", (req, res) => {
    console.log('📍 Rota: GET /logout');
    req.session.destroy(() => {
        console.log('✅ Sessão destruída');
        res.redirect('/');
    });
});

app.get("/dashboard", proteger, async (req, res) => {
    console.log('📍 Rota: GET /dashboard');
    try {
        const produtosBaixos = await runQuery(
            `SELECT p.*, COALESCE(e.quantidade, 0) as quantidade
             FROM produtos p 
             LEFT JOIN estoque e ON p.id_produto = e.id_produto 
             WHERE COALESCE(e.quantidade, 0) < 5 
             ORDER BY COALESCE(e.quantidade, 0) ASC`
        );
        
        const totalProdutos = (await runQuery("SELECT COUNT(*) FROM produtos"))[0].count;
        const totalVendas = (await runQuery("SELECT COUNT(*) FROM vendas"))[0].count;

        console.log('📊 Stats - Produtos:', totalProdutos, 'Vendas:', totalVendas, 'Baixos:', produtosBaixos.length);

        res.render("dashboard", {
            user: req.session.user,
            produtosBaixos,
            totalProdutos,
            totalMov: totalVendas
        });
    } catch (err) {
        console.error('❌ Erro no dashboard:', err);
        res.status(500).send(`Erro ao carregar dashboard: ${err.message}`);
    }
});

app.get("/cadastro-produto", proteger, async (req, res) => {
    console.log('📍 Rota: GET /cadastro-produto');
    try {
        const busca = req.query.busca || '';
        console.log('Busca:', busca || '(vazio)');
        
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

        console.log('✅ Produtos encontrados:', produtos.length);

        res.render("cadastro-produto", { 
            user: req.session.user, 
            produtos, 
            busca 
        });
    } catch (err) {
        console.error('❌ Erro ao listar produtos:', err);
        res.status(500).send(`Erro ao carregar produtos: ${err.message}`);
    }
});

app.post("/cadastro-produto", proteger, async (req, res) => {
    console.log('📍 Rota: POST /cadastro-produto');
    const { nome, quantidade, preco } = req.body;
    console.log('Dados recebidos:', { nome, quantidade, preco });
    
    if (!nome || !quantidade || !preco) {
        console.log('❌ Dados incompletos');
        return res.status(400).send("Preencha todos os campos!");
    }

    try {
        const produto = await runQuery(
            "INSERT INTO produtos (nome, preco) VALUES ($1, $2) RETURNING id_produto",
            [nome, preco]
        );

        await runQuery(
            "INSERT INTO estoque (id_produto, quantidade) VALUES ($1, $2)",
            [produto[0].id_produto, quantidade]
        );

        console.log('✅ Produto cadastrado com sucesso! ID:', produto[0].id_produto);
        res.redirect("/cadastro-produto");
    } catch (err) {
        console.error('❌ Erro ao cadastrar:', err);
        res.status(500).send(`Erro ao cadastrar: ${err.message}`);
    }
});

app.post("/cadastro-produto/update/:id", proteger, async (req, res) => {
    console.log('📍 Rota: POST /cadastro-produto/update/:id');
    const { id } = req.params;
    const { nome, quantidade, preco } = req.body;
    console.log('Atualizando produto ID:', id, { nome, quantidade, preco });

    try {
        await runQuery(
            "UPDATE produtos SET nome=$1, preco=$2 WHERE id_produto=$3",
            [nome, preco, id]
        );

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

        console.log('✅ Produto atualizado com sucesso!');
        res.redirect("/cadastro-produto");
    } catch (err) {
        console.error('❌ Erro ao atualizar:', err);
        res.status(500).send(`Erro ao atualizar: ${err.message}`);
    }
});

app.post("/cadastro-produto/delete/:id", proteger, async (req, res) => {
    console.log('📍 Rota: POST /cadastro-produto/delete/:id');
    const { id } = req.params;
    console.log('Deletando produto ID:', id);

    try {
        const vendas = await runQuery(
            "SELECT COUNT(*) FROM vendas WHERE id_produto=$1",
            [id]
        );

        if (parseInt(vendas[0].count) > 0) {
            console.log('❌ Produto tem vendas registradas');
            return res.status(400).send("Não é possível excluir! Existem vendas registradas.");
        }

        await runQuery("DELETE FROM estoque WHERE id_produto=$1", [id]);
        await runQuery("DELETE FROM produtos WHERE id_produto=$1", [id]);
        
        console.log('✅ Produto deletado com sucesso!');
        res.redirect("/cadastro-produto");
    } catch (err) {
        console.error('❌ Erro ao deletar:', err);
        res.status(500).send(`Erro ao deletar: ${err.message}`);
    }
});

app.get("/movimentacoes", proteger, async (req, res) => {
    console.log('📍 Rota: GET /movimentacoes');
    try {
        const produtos = await runQuery(
            "SELECT * FROM produtos ORDER BY nome"
        );
        
        const vendas = await runQuery(
            `SELECT v.id_venda, v.id_produto, v.quantidade, v.preco_total, v.data_venda, p.nome, u.nickname 
             FROM vendas v 
             JOIN produtos p ON v.id_produto = p.id_produto 
             JOIN usuarios u ON v.id_usuario = u.id_usuario 
             ORDER BY v.data_venda DESC`
        );

        console.log('✅ Produtos disponíveis:', produtos.length, 'Vendas:', vendas.length);

        res.render("movimentacoes", { 
            user: req.session.user, 
            produtos, 
            movimentos: vendas 
        });
    } catch (err) {
        console.error('❌ Erro ao carregar vendas:', err);
        res.status(500).send(`Erro ao carregar vendas: ${err.message}`);
    }
});

app.post("/movimentacoes", proteger, async (req, res) => {
    console.log('📍 Rota: POST /movimentacoes');
    const { produto_id, quantidade } = req.body;
    const user_id = req.session.user.id_usuario;
    console.log('Registrando venda:', { produto_id, quantidade, user_id });

    try {
        const estoque = await runQuery(
            "SELECT quantidade FROM estoque WHERE id_produto=$1",
            [produto_id]
        );

        if (estoque.length === 0) {
            console.log('❌ Produto não encontrado no estoque');
            return res.status(400).send("Produto não encontrado no estoque!");
        }

        if (estoque[0].quantidade < parseInt(quantidade)) {
            console.log('❌ Estoque insuficiente. Disponível:', estoque[0].quantidade, 'Solicitado:', quantidade);
            return res.status(400).send(`Estoque insuficiente! Disponível: ${estoque[0].quantidade}`);
        }

        const produto = await runQuery(
            "SELECT preco FROM produtos WHERE id_produto=$1", 
            [produto_id]
        );
        
        const preco_total = produto[0].preco * quantidade;
        console.log('Valor total da venda:', preco_total);

        await runQuery(
            'INSERT INTO vendas (id_usuario, id_produto, quantidade, preco_total) VALUES ($1, $2, $3, $4)',
            [user_id, produto_id, quantidade, preco_total]
        );

        await runQuery(
            "UPDATE estoque SET quantidade = quantidade - $1 WHERE id_produto = $2",
            [quantidade, produto_id]
        );

        console.log('✅ Venda registrada com sucesso!');
        res.redirect("/movimentacoes");
    } catch (err) {
        console.error('❌ Erro ao registrar venda:', err);
        res.status(500).send(`Erro ao registrar venda: ${err.message}`);
    }
});

// Tratamento de erro 404
app.use((req, res) => {
    console.log('❌ 404 - Página não encontrada:', req.url);
    res.status(404).send('Página não encontrada');
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
    console.log(`${'='.repeat(50)}\n`);
});