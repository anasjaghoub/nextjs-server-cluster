// server.js
const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3001
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

const cluster = require('node:cluster');
const { cpus } = require('node:os');
const numCPUs = cpus().length;
console.log('cpus length ', numCPUs)

const notifyAllWorkers = (msg) => {
    console.log('notify All workers')
    for (const id in cluster.workers) {
        cluster.workers[id].send(msg)
    }
}


const initialize = async () => {
    if (cluster.isPrimary) {
        const initializedWorkers = new Map()
        console.log(`Primary ${process.pid} is running`);

        const json = await fetch('https://jsonplaceholder.typicode.com/todos')
            .then(response => response.json())
            .then(json => json)

            let data = []
            for(i = 0; i < 100; i++) {
                data = data.concat(json)
            }
            console.log(JSON.stringify(data).length/1024, " KB of data") 

        // Fork workers.
        for (let i = 0; i < numCPUs; i++) {
            cluster.fork();
            //worker.send({ type: 'todos', todos: data })
        }
        for (const id in cluster.workers) {
            cluster.workers[id].on('message', (msg) => {
                console.log("Master got message", msg.type)
                const { type } = msg
                switch (type) {
                    case 'initialized':
                        const { worker } = msg
                        initializedWorkers.set(worker, 1)
                        console.log('initialzied workers size', initializedWorkers.size, Object.values(cluster.workers).length)
                        if (initializedWorkers.size === Object.values(cluster.workers).length) {
                            notifyAllWorkers({ type: 'todos', todos: data })
                        }
                        break
                }
            });
        }

        cluster.on('exit', (worker, code, signal) => {
            console.log(`worker ${worker.process.pid} died`);
        });
    } else {
        // Workers can share any TCP connection
        // In this case it is an HTTP server
        let todos = null
        await app.prepare().then(() => {
            process.send({ type: 'initialized', worker: process.pid })
            process.on('message', (msg) => {
                console.log('Cluster', process.pid, 'Got message', msg.type)
                if (msg.type === 'todos') {
                    todos = msg.todos
                }
            })
            createServer(async (req, res) => {
                console.log(`Worker ${process.pid} got request`, req.url);
                try {
                    // Be sure to pass `true` as the second argument to `url.parse`.
                    // This tells it to parse the query portion of the URL.
                    const parsedUrl = parse(req.url, true)
                    const { pathname, query } = parsedUrl

                    if (pathname === '/a') {
                        await app.render(req, res, '/a', query)
                    } else if (pathname === '/b') {
                        await app.render(req, res, '/b', query)
                    } else {
                        if (todos) {
                            res.statusCode = 200;
                            res.setHeader('Content-Type', 'application/json');
                            res.write(JSON.stringify(todos))
                            res.end()
                        } else {
                            await handle(req, res, parsedUrl)
                        }
                    }
                } catch (err) {
                    console.error('Error occurred handling', req.url, err)
                    res.statusCode = 500
                    res.end('internal server error')
                }
            }).listen(port, (err) => {
                if (err) throw err
                console.log(`> Ready on http://${hostname}:${port}`)
            })
        })
        console.log(`Worker ${process.pid} started`);
    }
}

initialize().then(() => console.log('initialized', { primary: cluster.isPrimary, worker: cluster.isWorker })).catch(err => console.error(err))