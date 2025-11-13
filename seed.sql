DROP DATABASE IF EXISTS cantina_db;
CREATE DATABASE cantina_db;
\c cantina_db;

CREATE TABLE produtos (
    id_produto SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    preco DECIMAL(10, 2) NOT NULL
);

CREATE TABLE usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nickname VARCHAR(50) NOT NULL,
    senha VARCHAR(100) NOT NULL
);

CREATE TABLE estoque (
    id_estoque SERIAL PRIMARY KEY,
    id_produto INT REFERENCES produtos(id_produto),
    quantidade INT DEFAULT 0
);

CREATE TABLE vendas (
    id_venda SERIAL PRIMARY KEY,
    id_usuario INT REFERENCES usuarios(id_usuario),
    id_produto INT REFERENCES produtos(id_produto),
    quantidade INT DEFAULT 1,
    preco_total DECIMAL(10, 2) NOT NULL,
    data_venda TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO produtos (nome, preco) VALUES 
('Sanduíche Natural', 8.50),
('Bolo de Chocolate', 4.00),
('Coxinha', 5.00),
('Pastel', 6.00),
('Refrigerante Lata', 4.00),
('Suco Natural', 7.00),
('Água Mineral', 3.00);

INSERT INTO usuarios (nickname, senha) VALUES 
('Kleber', 'senha123'),
('Josefina', 'senha456');

INSERT INTO estoque (id_produto, quantidade) VALUES 
(1, 20),
(2, 15),
(3, 30),
(4, 25),
(5, 50),
(6, 10),
(7, 40);

INSERT INTO vendas (id_usuario, id_produto, quantidade, preco_total) VALUES 
(1, 1, 2, 17.00),
(2, 3, 1, 5.00),
(1, 5, 3, 12.00);